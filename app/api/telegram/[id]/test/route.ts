import { BRAND_NAME } from "@/lib/brand";
import { NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import { decrypt } from "@/lib/encryption";
import { sendTelegramMessage } from "@/lib/alert-engine";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Step = "auth" | "load" | "decrypt" | "send" | "save";

function fail(step: Step, error: string, details?: string, status = 400) {
  console.error(`[tg-test] step=${step} status=${status} error=${error}`);
  return NextResponse.json({ error, details: details ?? error, step }, { status });
}

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return fail("auth", "Unauthorized", "no_session", 401);
  }

  const rl = rateLimit(`tg-test:${user.id}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests", step: "auth" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("telegram_connections")
    .select(
      "id, bot_username, bot_token_encrypted, chat_id, chat_title",
    )
    .eq("id", params.id)
    .maybeSingle();
  if (error) {
    return fail("load", "Не удалось загрузить подключение", error.message, 502);
  }
  if (!data) {
    return fail("load", "Подключение не найдено или нет доступа", "not_found", 404);
  }

  let token: string;
  try {
    token = decrypt((data as { bot_token_encrypted: string }).bot_token_encrypted);
    if (!token) throw new Error("пустой токен");
  } catch (e) {
    return fail(
      "decrypt",
      "Не удалось расшифровать токен. Возможно, изменился ENCRYPTION_KEY — пересоздайте подключение.",
      e instanceof Error ? e.message : String(e),
      500,
    );
  }

  const text = `✅ ${BRAND_NAME}: тест подключения от ${user.email ?? "пользователя"}`;
  const send = await sendTelegramMessage({
    token,
    chatId: (data as { chat_id: string }).chat_id,
    text,
    parseMode: "none",
  });

  const nowIso = new Date().toISOString();
  if (!send.ok) {
    await supabase
      .from("telegram_connections")
      .update({
        last_test_at: nowIso,
        last_test_status: "error",
        last_test_error: send.error,
      })
      .eq("id", params.id);
    void logAudit(
      supabase,
      user.id,
      "telegram_connection_tested",
      "telegram_connection",
      params.id,
      { ok: false, error: send.error },
    );
    return fail("send", "Telegram не принял запрос", send.error);
  }

  await supabase
    .from("telegram_connections")
    .update({
      last_test_at: nowIso,
      last_test_status: "ok",
      last_test_error: null,
    })
    .eq("id", params.id);

  void logAudit(
    supabase,
    user.id,
    "telegram_connection_tested",
    "telegram_connection",
    params.id,
    { ok: true },
  );
  return NextResponse.json({ ok: true, lastTestAt: nowIso });
}
