import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/server-auth";

/** Приватный бакет со скриншотами области (создан миграцией 017). */
export const FEEDBACK_BUCKET = "feedback-screenshots";
/** Лимит размера PNG-скриншота (после base64-декода). */
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024; // 4 МБ
/** Время жизни подписанной ссылки на скриншот. */
const SIGNED_URL_TTL_SECONDS = 600; // 10 минут

/**
 * Короткоживущий signed URL на приватный скриншот. Вызывать ТОЛЬКО после
 * проверки прав (автор заявки или админ) — RLS уже ограничивает строки, которые
 * сюда попадают. Возвращает null, если пути нет или ошибка.
 */
export async function signScreenshot(
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  try {
    const svc = createServiceRoleSupabaseClient();
    const { data, error } = await svc.storage
      .from(FEEDBACK_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
