import { BRAND_NAME } from "@/lib/brand";
import type {
  AIModelId,
  DatasetColumn,
  FilterCondition,
  FunnelStep,
  QueryResultRow,
} from "@/lib/types";
import {
  KEY_COLUMN,
  PROVIDERS,
  resolveModel,
  type AIProvider,
} from "@/lib/ai-models";
import { prepareAnthropicKey } from "@/lib/anthropic-key";
import { decrypt } from "@/lib/encryption";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import {
  buildReverseMap,
  buildValuePairs,
  createReverseReplacer,
  emptyAnonState,
  extendAnonState,
  maskRows,
  maskText,
  rowsToCsv,
} from "@/lib/anonymize";
import { loadAnonState, saveAnonState } from "@/lib/anonymize-store";
import { extractProviderError, isBalanceError } from "@/lib/provider-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ColumnDescription {
  name: string;
  description?: string;
}

interface Body {
  prompt: string;
  dataType: "dataset" | "visualization";
  dataId: string;
  columns: DatasetColumn[];
  csv: string;
  model?: AIModelId;
  /** Системный шаблон (для быстрых действий). Если передан — кладётся в system-промпт перед контекстом. */
  systemTemplate?: string;
  /** Описание бизнеса / продукта / KPI (dataset.businessContext). */
  businessContext?: string;
  /** AI-описания столбцов (имя + описание). */
  columnDescriptions?: ColumnDescription[];
  /** Настроенная воронка датасета. */
  funnelSteps?: FunnelStep[];
  /** "Что изменилось недавно" — дополнительный пользовательский контекст. */
  additionalContext?: string;
  /**
   * Активные фильтры данных (применены клиентом к CSV перед отправкой).
   * Передаются только для контекста в system-промпте, чтобы Claude знал,
   * какой срез данных он анализирует.
   */
  filters?: FilterCondition[];
  /** Количество строк в CSV после применения фильтров (для контекста). */
  filteredRowCount?: number;
  /** ID проекта — нужен для загрузки/сохранения словаря токенизации. */
  projectId?: string;
  /**
   * Сырые строки данных (структурно). Передаются клиентом ТОЛЬКО когда включён
   * режим конфиденциальности — сервер сам маскирует их и собирает CSV. В
   * обычном режиме клиент шлёт уже готовый `csv`, а `rows` отсутствует.
   */
  rows?: QueryResultRow[];
  /** Конфиденциальные столбцы (NDA): их значения токенизируются перед отправкой. */
  confidentialColumns?: string[];
  /**
   * Если задано — данные являются СВОДНОЙ таблицей, сгруппированной по этим
   * измерениям (агрегация по всему датасету). Передаются только имена столбцов
   * (не значения), чтобы Claude верно интерпретировал строки как группы.
   */
  groupingDimensions?: string[];
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rl = rateLimit(
    `ai:${user.id}`,
    RATE_LIMITS.AI_ANALYZE.limit,
    RATE_LIMITS.AI_ANALYZE.windowMs,
  );
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too Many Requests" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(rl.retryAfterSeconds),
      },
    });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch (e) {
    return sseErrorResponse(
      e instanceof Error ? e.message : "Invalid request body",
    );
  }

  // Определяем модель и провайдера (Anthropic / OpenAI / Google).
  const modelInfo = resolveModel(body.model);
  const modelId: AIModelId = modelInfo.id;
  const provider: AIProvider = modelInfo.provider;

  // Загружаем ключ НУЖНОГО провайдера из Supabase (хранится зашифрованным).
  const supabase = createServerSupabaseClient();
  const keyColumn = KEY_COLUMN[provider];
  const { data: settingsRow } = await supabase
    .from("user_settings")
    .select(keyColumn)
    .eq("user_id", user.id)
    .maybeSingle();
  const encryptedKey = (settingsRow as Record<string, string> | null)?.[
    keyColumn
  ];
  const rawKey = encryptedKey ? decrypt(encryptedKey) : "";
  if (!rawKey) {
    return sseErrorResponse(
      `Не настроен API-ключ ${PROVIDERS[provider].label}. Откройте «Контекст» → «Модель и ключи» и добавьте ключ.`,
    );
  }
  // Для Anthropic — строгая подготовка ключа (чистка/валидация); для остальных
  // достаточно расшифрованного значения.
  let apiKey = rawKey;
  if (provider === "anthropic") {
    const keyCheck = prepareAnthropicKey(rawKey);
    if (!keyCheck.ok) {
      return sseErrorResponse(keyCheck.error);
    }
    apiKey = keyCheck.key;
  }

  // --- Режим конфиденциальности (NDA): токенизация перед отправкой в Claude ---
  // Включается ТОЛЬКО если переданы конфиденциальные столбцы и сырые строки.
  // Иначе — поведение ровно как раньше (csv от клиента уходит как есть).
  const confidential = Array.isArray(body.confidentialColumns)
    ? body.confidentialColumns.filter(
        (c): c is string => typeof c === "string" && c.trim().length > 0,
      )
    : [];
  const anonEnabled = confidential.length > 0 && Array.isArray(body.rows);

  let csvForClaude = body.csv;
  let reverseReplacer: ReturnType<typeof createReverseReplacer> | null = null;

  if (anonEnabled) {
    const rows = body.rows as QueryResultRow[];
    // Загружаем существующий словарь проекта (расшифровываем) и дополняем.
    const prevState = body.projectId
      ? await loadAnonState(supabase, body.projectId)
      : emptyAnonState();
    const { state, changed } = extendAnonState(prevState, rows, confidential);
    if (changed && body.projectId) {
      await saveAnonState(supabase, body.projectId, user.id, state);
    }

    // CSV для Claude — из ЗАМАСКИРОВАННЫХ строк (реальные имена → коды).
    csvForClaude = rowsToCsv(maskRows(rows, confidential, state));

    // Авто-маскировка свободного текста: если пользователь упомянул реальное
    // имя в промпте/контексте/описаниях/воронке — заменяем на код, чтобы оно
    // не утекло в Claude в открытом виде.
    const pairs = buildValuePairs(state);
    body.prompt = maskText(body.prompt, pairs);
    if (body.systemTemplate)
      body.systemTemplate = maskText(body.systemTemplate, pairs);
    if (body.businessContext)
      body.businessContext = maskText(body.businessContext, pairs);
    if (body.additionalContext)
      body.additionalContext = maskText(body.additionalContext, pairs);
    if (body.columnDescriptions) {
      body.columnDescriptions = body.columnDescriptions.map((cd) => ({
        name: cd.name,
        description: cd.description ? maskText(cd.description, pairs) : cd.description,
      }));
    }
    if (body.funnelSteps) {
      body.funnelSteps = body.funnelSteps.map((s) => ({
        ...s,
        label: maskText(s.label, pairs),
      }));
    }
    // Описания самих столбцов (попадают в system-промпт как фоллбэк) — тоже
    // могут содержать реальные имена.
    if (Array.isArray(body.columns)) {
      body.columns = body.columns.map((c) => ({
        ...c,
        businessContext: c.businessContext
          ? maskText(c.businessContext, pairs)
          : c.businessContext,
        description: c.description ? maskText(c.description, pairs) : c.description,
      }));
    }
    // Значения фильтров идут в system-промпт как контекст среза. Фильтр по
    // конфиденциальному столбцу содержит реальное имя → маскируем значение.
    if (Array.isArray(body.filters)) {
      body.filters = body.filters.map((f) => ({
        ...f,
        value: typeof f.value === "string" ? maskText(f.value, pairs) : f.value,
      }));
    }

    // Обратная замена кодов → реальные имена в ответе (буфер для SSE).
    reverseReplacer = createReverseReplacer(buildReverseMap(state));
  }

  const systemPrompt = buildSystemPrompt(body);
  const userContent = `Данные (CSV, до 500 строк):\n\`\`\`csv\n${csvForClaude}\n\`\`\`\n\nЗапрос: ${body.prompt}`;

  const upstream = await callUpstream(provider, {
    apiKey,
    apiId: modelInfo.apiId,
    system: systemPrompt,
    userContent,
    signal: request.signal,
  }).catch((e: unknown) => {
    return new Response(
      JSON.stringify({
        error: {
          message: e instanceof Error ? e.message : String(e),
        },
      }),
      { status: 500 },
    );
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    const detail = extractProviderError(errText);
    const label = PROVIDERS[provider].label;
    // Ключ валиден, но на счёте провайдера нет средств/кредитов (или исчерпана
    // квота) — частая причина. Объясняем по-человечески: пользователь подключил
    // токен и не должен гадать, почему анализ не идёт.
    if (
      upstream.status === 402 ||
      isBalanceError(errText) ||
      isBalanceError(detail)
    ) {
      return sseErrorResponse(
        `На счёте ${label} недостаточно средств/кредитов для запроса. ` +
          `API-ключ подключён верно — дело в балансе у провайдера, не в ${BRAND_NAME}. ` +
          `Пополните счёт в консоли провайдера (${PROVIDERS[provider].consoleLabel}, раздел Billing) и повторите.`,
      );
    }
    // Иначе — РЕАЛЬНАЯ причина от провайдера (а не голый «HTTP 404»):
    // имя провайдера + его сообщение, либо статус с понятной подсказкой.
    return sseErrorResponse(
      detail
        ? `${label}: ${detail}`
        : `${label} вернул ошибку HTTP ${upstream.status}. Проверьте API-ключ ` +
            `(«Контекст → Модели и ключи») и доступность модели «${modelInfo.label}».`,
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const userIdForLog = user.id;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";
      let inputTokens = 0;
      let outputTokens = 0;

      const writeEvent = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sepIdx: number;
          while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
            const rawEvent = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);

            const dataLines = rawEvent
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trim());
            if (dataLines.length === 0) continue;
            const data = dataLines.join("\n");
            if (!data || data === "[DONE]") continue;

            try {
              const ev = parseProviderEvent(provider, JSON.parse(data));
              if (typeof ev.text === "string" && ev.text) {
                // В режиме конфиденциальности прогоняем кусок через буфер
                // обратной замены (код → реальное имя). Незавершённый «хвост»
                // кода придерживается до следующего чанка. Провайдеро-независимо.
                const out = reverseReplacer
                  ? reverseReplacer.push(ev.text)
                  : ev.text;
                if (out) writeEvent({ type: "text", content: out });
              }
              // Токены: финальные значения провайдера перезаписывают (last-wins).
              if (typeof ev.input === "number") inputTokens = ev.input;
              if (typeof ev.output === "number") outputTokens = ev.output;
            } catch {
              // ignore malformed chunk
            }
          }
        }

        // Дослать остаток буфера обратной замены (возможный «хвост» кода).
        if (reverseReplacer) {
          const tail = reverseReplacer.flush();
          if (tail) writeEvent({ type: "text", content: tail });
        }

        const cost =
          (inputTokens / 1_000_000) * modelInfo.priceInput +
          (outputTokens / 1_000_000) * modelInfo.priceOutput;

        writeEvent({
          type: "done",
          cost: Number(cost.toFixed(6)),
          model: modelId,
          usage: { input: inputTokens, output: outputTokens },
        });

        // Аудит-лог: фиксируем успешный анализ. Не блокируем стрим — fire-and-forget.
        void logAudit(
          supabase,
          userIdForLog,
          "ai_analysis_run",
          body.dataType,
          body.dataId,
          {
            model: modelId,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cost: Number(cost.toFixed(6)),
          },
        );
      } catch (e) {
        writeEvent({
          type: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function buildSystemPrompt(body: Body): string {
  const parts: string[] = [];

  // Либо системный шаблон (быстрое действие), либо дефолтная роль аналитика.
  if (body.systemTemplate && body.systemTemplate.trim()) {
    parts.push(body.systemTemplate.trim());
  } else {
    parts.push(
      "Ты — опытный аналитик данных. Тебе предоставлены данные в формате CSV. Проанализируй их и ответь на запрос пользователя.",
    );
  }

  // Графики и файлы создаёт сама платформа (кнопки под ответом), не модель —
  // поэтому просим не вываливать код matplotlib/ASCII-графики.
  parts.push(
    "Важно: графики и файлы (PNG, Excel, PDF) создаёт сама платформа, а не ты. Если пользователь просит построить график или собрать Excel — НЕ пиши код (matplotlib, pandas и т.п.) и не рисуй ASCII-графики. Вместо этого кратко подскажи, что под твоим ответом есть кнопки «Построить график» (с выбором типа и скачиванием PNG) и «Скачать Excel». Сам сосредоточься на текстовой аналитике, цифрах и выводах.",
  );

  if (body.businessContext && body.businessContext.trim()) {
    parts.push(`Контекст бизнеса: ${body.businessContext.trim()}`);
  }

  // Описания столбцов: сначала детальные aiDescription (если переданы),
  // затем стандартные типы всех enabled-столбцов как фоллбэк.
  const aiDescMap = new Map<string, string>();
  for (const cd of body.columnDescriptions ?? []) {
    if (cd.description && cd.description.trim()) {
      aiDescMap.set(cd.name, cd.description.trim());
    }
  }

  const columnLines = body.columns.map((c) => {
    const aiDesc = aiDescMap.get(c.name);
    const tail = aiDesc
      ? `: ${aiDesc}`
      : c.businessContext?.trim()
        ? `: ${c.businessContext.trim()}`
        : c.description
          ? `: ${c.description}`
          : "";
    return `- ${c.name} (${c.datasetType}/${c.clickhouseType})${tail}`;
  });
  if (columnLines.length > 0) {
    parts.push(`Столбцы:\n${columnLines.join("\n")}`);
  }

  // Сводная таблица: явно сообщаем Claude, что строки — это группы (агрегаты),
  // а не отдельные записи. Имена измерений безопасны (значения маскируются).
  if (body.groupingDimensions && body.groupingDimensions.length > 0) {
    parts.push(
      `Важно: данные ниже — это СВОДНАЯ таблица (агрегация по всему датасету), ` +
        `сгруппированная по столбцам: ${body.groupingDimensions.join(", ")}. ` +
        "Каждая строка — отдельная группа, а не одна запись; остальные столбцы — " +
        "агрегированные метрики (суммы, средние и т.п.). Учитывай это в расчётах.",
    );
  }

  if (body.funnelSteps && body.funnelSteps.length > 0) {
    const ordered = [...body.funnelSteps].sort((a, b) => a.order - b.order);
    const funnelLine = ordered
      .map((s, i) => `${i + 1}) ${s.label} (${s.column})`)
      .join(" → ");
    parts.push(
      `Справочный контекст — воронка конверсии (порядок этапов): ${funnelLine}. ` +
        "Это фоновая информация о структуре данных. Используй её только если она " +
        "помогает ответить на запрос пользователя; не делай воронку темой ответа " +
        "и не отклоняйся от заданного вопроса.",
    );
  }

  if (body.filters && body.filters.length > 0) {
    const filterLines = body.filters
      .filter((f) => f.column && f.value !== "")
      .map((f) => `- ${f.column} ${f.operator} ${f.value}`);
    if (filterLines.length > 0) {
      const header = `Применённые фильтры данных${
        typeof body.filteredRowCount === "number"
          ? ` (срез: ${body.filteredRowCount} строк)`
          : ""
      }:`;
      parts.push(`${header}\n${filterLines.join("\n")}`);
    }
  }

  if (body.additionalContext && body.additionalContext.trim()) {
    parts.push(`Дополнительный контекст пользователя: ${body.additionalContext.trim()}`);
  }

  parts.push(
    [
      "Отвечай структурированно на русском языке, используя markdown:",
      "- Используй заголовки (##), списки, жирный текст и таблицы.",
      "- Приводи конкретные цифры из данных.",
      "- Если видишь аномалии, тренды или закономерности — выделяй их.",
      "Не выдумывай данные, которых нет. Если в данных чего-то не хватает — скажи об этом прямо.",
    ].join("\n"),
  );

  return parts.join("\n\n");
}

/**
 * Стриминговый запрос к нужному провайдеру. Все три (Anthropic / OpenAI /
 * Google) отдают SSE с кадрами `data: {json}` — общий ридер ниже их разбирает,
 * а различается только тело запроса и формат события (см. parseProviderEvent).
 */
function callUpstream(
  provider: AIProvider,
  opts: {
    apiKey: string;
    apiId: string;
    system: string;
    userContent: string;
    signal: AbortSignal;
  },
): Promise<Response> {
  const { apiKey, apiId, system, userContent, signal } = opts;
  const cfg = PROVIDERS[provider];
  if (cfg.apiKind === "openai-compatible") {
    // OpenAI и совместимые (Groq / Cerebras / Mistral) — один формат, разный base.
    const reqBody: Record<string, unknown> = {
      model: apiId,
      max_tokens: 4096,
      stream: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    };
    // include_usage поддерживают не все совместимые — включаем только у OpenAI.
    if (provider === "openai") reqBody.stream_options = { include_usage: true };
    return fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(reqBody),
      signal,
    });
  }
  if (cfg.apiKind === "google") {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(apiId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        generationConfig: { maxOutputTokens: 4096 },
      }),
      signal,
    });
  }
  // anthropic (по умолчанию)
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: apiId,
      max_tokens: 4096,
      stream: true,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
    signal,
  });
}

/** Унифицирует SSE-событие провайдера: текст-дельта + (если есть) счётчики токенов. */
function parseProviderEvent(
  provider: AIProvider,
  json: unknown,
): { text?: string; input?: number; output?: number } {
  const kind = PROVIDERS[provider].apiKind;
  if (kind === "openai-compatible") {
    const j = json as {
      choices?: { delta?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      // Groq кладёт счётчики в x_groq.usage финального чанка.
      x_groq?: { usage?: { prompt_tokens?: number; completion_tokens?: number } };
    };
    const usage = j.usage ?? j.x_groq?.usage;
    return {
      text: j.choices?.[0]?.delta?.content,
      input: usage?.prompt_tokens,
      output: usage?.completion_tokens,
    };
  }
  if (kind === "google") {
    const j = json as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };
    const parts = j.candidates?.[0]?.content?.parts;
    const text = parts?.map((p) => p.text ?? "").join("");
    return {
      text: text || undefined,
      input: j.usageMetadata?.promptTokenCount,
      output: j.usageMetadata?.candidatesTokenCount,
    };
  }
  // anthropic
  const j = json as {
    type?: string;
    delta?: { type?: string; text?: string };
    message?: { usage?: { input_tokens?: number; output_tokens?: number } };
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
    return { text: j.delta.text };
  }
  if (j.type === "message_start") {
    return {
      input: j.message?.usage?.input_tokens,
      output: j.message?.usage?.output_tokens,
    };
  }
  if (j.type === "message_delta") {
    return { input: j.usage?.input_tokens, output: j.usage?.output_tokens };
  }
  return {};
}

function sseErrorResponse(message: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "error", error: message })}\n\n`,
        ),
      );
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
