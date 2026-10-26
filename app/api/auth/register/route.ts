import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isThrottle(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("for security purposes") ||
    m.includes("you can only request this") ||
    m.includes("rate limit") ||
    m.includes("too many") ||
    m.includes("over_email_send")
  );
}

/**
 * Регистрация НА СЕРВЕРЕ. Зачем: из браузера в РФ `signUp` идёт прямо к
 * supabase.co и синхронно шлёт письмо (медленно) — запрос часто обрывается
 * («Failed to fetch»). Здесь signUp выполняется на сервере (Vercel↔Supabase
 * внутри ЕС — надёжно), а браузер делает один быстрый запрос к нашему API.
 */
export async function POST(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }

  let body: {
    fullName?: string;
    email?: string;
    password?: string;
    redirectTo?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const fullName = (body.fullName ?? "").trim();
  const email = (body.email ?? "").trim();
  const password = body.password ?? "";
  const redirectTo =
    typeof body.redirectTo === "string" ? body.redirectTo : undefined;

  if (!fullName || !EMAIL_RE.test(email) || password.length < 6) {
    return NextResponse.json(
      { error: "Проверьте имя, email и пароль (минимум 6 символов).", code: "validation" },
      { status: 400 },
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Уже зарегистрирован (в т.ч. НЕподтверждённый)? Честно сообщаем.
  try {
    const { data: exists } = await supabase.rpc("email_is_registered", {
      p_email: email,
    });
    if (exists === true) {
      return NextResponse.json(
        { error: "already_registered", code: "already_registered" },
        { status: 409 },
      );
    }
  } catch {
    // проверка недоступна — продолжаем обычной регистрацией
  }

  // 2) signUp — создаёт пользователя и шлёт письмо подтверждения (через SMTP, настроенный в Supabase).
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      ...(redirectTo ? { emailRedirectTo: redirectTo } : {}),
    },
  });

  if (error) {
    if (isThrottle(error.message)) {
      const sec = error.message.match(/after (\d+)\s*seconds?/i)?.[1];
      return NextResponse.json(
        { error: error.message, code: "throttled", retryAfter: sec ? Number(sec) : undefined },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: error.message, code: "error" },
      { status: 400 },
    );
  }

  // Защита от перебора email: пустой identities = email уже зарегистрирован.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return NextResponse.json(
      { error: "already_registered", code: "already_registered" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}
