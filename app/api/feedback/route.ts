import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  createServiceRoleSupabaseClient,
  getAuthenticatedSupabase,
} from "@/lib/server-auth";
import {
  FEEDBACK_BUCKET,
  MAX_SCREENSHOT_BYTES,
  signScreenshot,
} from "@/lib/feedback-storage";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE = 5000;
const PNG_PREFIX = "data:image/png;base64,";

interface Body {
  message?: string;
  pageUrl?: string;
  screenshot?: string;
}

/** Создать обращение: текст + (опц.) скриншот области. Автор — из сессии. */
export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedSupabase();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const rl = rateLimit(`feedback:${user.id}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Слишком часто. Попробуйте через минуту." },
      { status: 429 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Опишите проблему" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json(
      { error: `Слишком длинный текст (макс ${MAX_MESSAGE} символов)` },
      { status: 400 },
    );
  }
  const pageUrl =
    typeof body.pageUrl === "string" ? body.pageUrl.slice(0, 2000) : null;

  // Скриншот валидируем на сервере: только PNG data-URL, лимит размера.
  let screenshotPath: string | null = null;
  const shot = body.screenshot;
  if (typeof shot === "string" && shot.length > 0) {
    if (!shot.startsWith(PNG_PREFIX)) {
      return NextResponse.json(
        { error: "Изображение должно быть PNG" },
        { status: 400 },
      );
    }
    const buf = Buffer.from(shot.slice(PNG_PREFIX.length), "base64");
    if (buf.length > MAX_SCREENSHOT_BYTES) {
      return NextResponse.json(
        { error: "Скриншот слишком большой (макс 4 МБ)" },
        { status: 400 },
      );
    }
    if (buf.length > 0) {
      try {
        const path = `${user.id}/${randomUUID()}.png`;
        const svc = createServiceRoleSupabaseClient();
        const { error: upErr } = await svc.storage
          .from(FEEDBACK_BUCKET)
          .upload(path, buf, { contentType: "image/png", upsert: false });
        // Загрузка не удалась — не блокируем заявку, просто без скриншота.
        if (!upErr) screenshotPath = path;
      } catch {
        // нет service-role / ошибка Storage — отправим обращение без скриншота.
      }
    }
  }

  // Вставка под RLS пользователя: user_id берётся из сессии (нельзя подменить).
  const { data, error } = await supabase
    .from("feedback")
    .insert({
      user_id: user.id,
      email: user.email ?? null,
      message,
      page_url: pageUrl,
      screenshot_path: screenshotPath,
      status: "new",
    })
    .select("id")
    .single();

  if (error) {
    // Не оставляем осиротевший скриншот, если строка не записалась.
    if (screenshotPath) {
      try {
        await createServiceRoleSupabaseClient()
          .storage.from(FEEDBACK_BUCKET)
          .remove([screenshotPath]);
      } catch {
        /* best-effort */
      }
    }
    return NextResponse.json(
      { error: "Не удалось сохранить обращение" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, id: data.id });
}

/** Список СВОИХ обращений (RLS ограничивает автором) + подписанные скриншоты. */
export async function GET() {
  const { supabase, user } = await getAuthenticatedSupabase();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { data, error } = await supabase
    .from("feedback")
    .select(
      "id, message, page_url, screenshot_path, status, admin_reply, created_at, updated_at",
    )
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: "Ошибка загрузки" }, { status: 500 });
  }
  const items = await Promise.all(
    (data ?? []).map(async (f) => {
      const { screenshot_path, ...rest } = f as typeof f & {
        screenshot_path: string | null;
      };
      return { ...rest, screenshot_url: await signScreenshot(screenshot_path) };
    }),
  );
  return NextResponse.json({ items });
}
