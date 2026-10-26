import { NextResponse } from "next/server";
import { sanitizeAnthropicKey } from "@/lib/anthropic-key";
import { encrypt } from "@/lib/encryption";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import { logAudit } from "@/lib/audit";
import {
  firstApiIdForProvider,
  KEY_COLUMN,
  PROVIDER_LIST,
  PROVIDERS,
  type AIProvider,
} from "@/lib/ai-models";
import { extractProviderError, isBalanceError } from "@/lib/provider-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  provider?: AIProvider;
  apiKey?: string;
}

/** Лёгкая валидация формата ключа по провайдеру (пусто = очистка ключа). */
function validateKey(provider: AIProvider, raw: string): string | null {
  if (!raw) return null;
  if (provider === "anthropic" && !raw.startsWith("sk-ant-"))
    return "Ключ Anthropic должен начинаться с sk-ant-";
  if (provider === "openai" && !raw.startsWith("sk-"))
    return "Ключ OpenAI должен начинаться с sk-";
  // Остальные провайдеры: разные форматы — проверяем только непустоту/длину.
  if (provider !== "anthropic" && provider !== "openai" && raw.length < 8)
    return "Похоже, ключ неполный";
  return null;
}

type KeyTest = { status: "ok" | "invalid" | "unknown"; detail?: string };

/** Классифицирует ответ проверки: 200 → ok; 401/403 → invalid; иначе unknown.
 *  Для не-ok вытаскивает реальное сообщение провайдера (а не голый статус). */
async function classifyKeyResponse(res: Response): Promise<KeyTest> {
  if (res.ok) return { status: "ok" };
  const msg = extractProviderError(await res.text().catch(() => ""));
  if (res.status === 401 || res.status === 403)
    return { status: "invalid", detail: msg || `HTTP ${res.status}` };
  return { status: "unknown", detail: msg || `HTTP ${res.status}` };
}

/**
 * Проверка ключа реальным вызовом провайдера.
 * - Anthropic/Google — дешёвый GET `/models` (у них он надёжен).
 * - openai-совместимые (OpenAI/Groq/Cerebras/Mistral) — РЕАЛЬНЫЙ чат-вызов
 *   основной моделью провайдера (`max_tokens: 1`), тот же путь, что и анализ.
 *   Раньше тут был GET `/models`, но у Cerebras/Mistral он мог вернуть 404 →
 *   ключ сохранялся как «подключён», а анализ падал с «HTTP 404». Теперь
 *   несоответствие ключа/модели/эндпоинта ловится сразу.
 *
 * 200 → ok; 401/403 → invalid (не сохраняем как подключено); прочее (404/429/
 * 5xx/сеть/таймаут) → "unknown" — ключ сохраняем, но возвращаем причину как
 * предупреждение (анализ может не работать).
 */
async function testProviderKey(
  provider: AIProvider,
  key: string,
): Promise<KeyTest> {
  const cfg = PROVIDERS[provider];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    if (cfg.apiKind === "anthropic") {
      return await classifyKeyResponse(
        await fetch("https://api.anthropic.com/v1/models?limit=1", {
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
          signal: ctrl.signal,
        }),
      );
    }
    if (cfg.apiKind === "google") {
      return await classifyKeyResponse(
        await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`,
          { signal: ctrl.signal },
        ),
      );
    }
    // openai-совместимые: проверяем чат-вызовом основной модели провайдера.
    const apiId = firstApiIdForProvider(provider);
    if (!apiId) {
      return await classifyKeyResponse(
        await fetch(`${cfg.baseUrl}/models`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: ctrl.signal,
        }),
      );
    }
    return await classifyKeyResponse(
      await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: apiId,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
        signal: ctrl.signal,
      }),
    );
  } catch (e) {
    return {
      status: "unknown",
      detail: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Сохраняет API-ключ выбранного LLM-провайдера текущего пользователя в Supabase
 * в зашифрованном виде. Сырой ключ никогда не покидает серверный обработчик.
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as Body;
    const provider: AIProvider = PROVIDER_LIST.includes(
      body.provider as AIProvider,
    )
      ? (body.provider as AIProvider)
      : "anthropic";
    // Чистим невидимые юникод-символы (BOM, ZWSP и т.п.), ломающие HTTP-заголовки.
    const raw =
      typeof body.apiKey === "string" ? sanitizeAnthropicKey(body.apiKey) : "";
    const invalid = validateKey(provider, raw);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }

    // Проверяем ключ лёгким вызовом (только если он непустой — пустой = очистка).
    // «Как подключено» НЕ сохраняем, если ключ явно неверный (401/403).
    let verified = false;
    let warning: string | undefined;
    if (raw) {
      const test = await testProviderKey(provider, raw);
      if (test.status === "invalid") {
        return NextResponse.json(
          {
            error: `Ключ ${PROVIDERS[provider].label} не прошёл проверку (${
              test.detail ?? "неверный или нет доступа"
            }). Проверьте ключ и доступ в консоли провайдера.`,
          },
          { status: 400 },
        );
      }
      verified = test.status === "ok";
      // Ключ сохраняем, но честно предупреждаем, если проверка не подтвердилась.
      if (test.status === "unknown") {
        warning = isBalanceError(test.detail)
          ? `Ключ ${PROVIDERS[provider].label} валиден, но на счёте нет средств/кредитов. ` +
            `Пополните баланс в консоли провайдера — иначе анализ не пойдёт.`
          : `Ключ ${PROVIDERS[provider].label} сохранён, но проверка не подтвердилась: ${
              test.detail ?? "нет ответа от провайдера"
            }. Анализ на этой модели может не работать.`;
      }
    }

    const encrypted = raw ? encrypt(raw) : "";
    const supabase = createServerSupabaseClient();
    const { error } = await supabase.from("user_settings").upsert(
      {
        user_id: user.id,
        [KEY_COLUMN[provider]]: encrypted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await logAudit(
      supabase,
      user.id,
      "api_key_updated",
      `${provider}_api`,
      null,
      { cleared: raw === "" },
    );
    return NextResponse.json({
      ok: true,
      configured: raw !== "",
      provider,
      verified,
      warning,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
