import { NextResponse } from "next/server";
import { getAuthenticatedSupabase } from "@/lib/server-auth";
import { encrypt } from "@/lib/encryption";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import {
  telegramGetChat,
  telegramGetMe,
} from "@/lib/alert-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  name?: string;
  token?: string;
  chatId?: string;
}

type Step = "auth" | "input" | "encrypt" | "getMe" | "getChat" | "save";

type SupabaseErrFields = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

function fail(
  step: Step,
  error: string,
  details?: string,
  status = 400,
  supabaseErr?: SupabaseErrFields,
) {
  const detailLine = details ?? error;
  console.error(
    `[tg-verify] step=${step} status=${status} error=${error} details=${detailLine}`,
  );
  if (supabaseErr) {
    console.error(
      `[tg-verify] step=${step} supabase code=${supabaseErr.code ?? ""} message=${supabaseErr.message ?? ""} details=${supabaseErr.details ?? ""} hint=${supabaseErr.hint ?? ""}`,
    );
  }
  const body: {
    error: string;
    details: string;
    step: Step;
    supabase?: {
      code: string | null;
      message: string | null;
      details: string | null;
      hint: string | null;
    };
  } = { error, details: detailLine, step };
  if (supabaseErr) {
    body.supabase = {
      code: supabaseErr.code ?? null,
      message: supabaseErr.message ?? null,
      details: supabaseErr.details ?? null,
      hint: supabaseErr.hint ?? null,
    };
  }
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedSupabase();
  if (!user) {
    return fail("auth", "Unauthorized", "no_session", 401);
  }

  const rl = rateLimit(`tg-verify:${user.id}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests", step: "auth" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch (e) {
    return fail("input", "Невалидный JSON", e instanceof Error ? e.message : String(e));
  }

  const name = (body.name ?? "").trim();
  const token = (body.token ?? "").trim();
  const chatId = (body.chatId ?? "").trim();
  if (!name || !token || !chatId) {
    return fail("input", "Заполните название, токен и chat_id", "missing_fields");
  }

  let tokenEncrypted: string;
  try {
    tokenEncrypted = encrypt(token);
  } catch (e) {
    return fail(
      "encrypt",
      "Не удалось зашифровать токен. Проверьте ENCRYPTION_KEY на сервере.",
      e instanceof Error ? e.message : String(e),
      500,
    );
  }

  console.log(`[tg-verify] step=getMe user=${user.id}`);
  const me = await telegramGetMe(token);
  if (!me.ok || !me.username) {
    return fail(
      "getMe",
      "Telegram не принял токен. Проверьте, что бот создан у @BotFather и токен скопирован полностью.",
      me.description,
    );
  }

  console.log(`[tg-verify] step=getChat user=${user.id} bot=${me.username}`);
  const chat = await telegramGetChat(token, chatId);
  if (!chat.ok) {
    return fail(
      "getChat",
      "Не удалось получить чат. Убедитесь, что бот добавлен в чат и chat_id корректен.",
      chat.description,
    );
  }

  console.log(`[tg-verify] step=save user=${user.id} bot=${me.username} chat=${chat.title}`);
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("telegram_connections")
    .insert({
      user_id: user.id,
      name,
      bot_username: me.username,
      bot_token_encrypted: tokenEncrypted,
      chat_id: chatId,
      chat_title: chat.title ?? chatId,
      is_verified: true,
      last_test_at: nowIso,
      last_test_status: "ok",
      last_test_error: null,
      created_at: nowIso,
    })
    .select(
      "id, name, bot_username, chat_id, chat_title, is_verified, last_test_at, last_test_status, last_test_error, created_at",
    )
    .single();

  if (error || !data) {
    const userMessage =
      error?.code === "PGRST116"
        ? "Не удалось получить данные после сохранения. Проверьте политику SELECT (RLS) для telegram_connections."
        : "Не удалось сохранить подключение в БД.";
    return fail(
      "save",
      userMessage,
      error?.message ?? "нет данных",
      500,
      error
        ? {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
          }
        : undefined,
    );
  }

  void logAudit(supabase, user.id, "telegram_connection_created", "telegram_connection", data.id as string, {
    bot_username: me.username,
  });

  return NextResponse.json({
    connection: {
      id: data.id,
      name: data.name,
      botUsername: data.bot_username,
      chatId: data.chat_id,
      chatTitle: data.chat_title,
      isVerified: data.is_verified,
      lastTestAt: data.last_test_at,
      lastTestStatus: data.last_test_status,
      lastTestError: data.last_test_error,
      createdAt: data.created_at,
    },
  });
}
