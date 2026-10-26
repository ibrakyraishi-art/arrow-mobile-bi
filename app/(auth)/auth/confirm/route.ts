import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Подтверждение email / сброс пароля по ссылке из письма — НА СЕРВЕРЕ (GET).
 *
 * Клик по ссылке → проверяем одноразовый токен → ставим сессию в cookies →
 * СРАЗУ редиректим пользователя в приложение. Никакого экрана «Подтверждаем…»
 * и зависаний: переход сразу в аккаунт.
 *
 * Если ссылку уже «съел» сканер почты (mail.ru агрессивно открывает ссылки)
 * или она устарела — verifyOtp вернёт ошибку. Тогда НЕ показываем тупик
 * «Ссылка не сработала», а мягко ведём на /login: аккаунт в этом случае,
 * как правило, уже активирован (сканер «подтвердил» его), и пользователь
 * заходит своими email и паролем, которые вводил при регистрации.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = (url.searchParams.get("type") as EmailOtpType | null) ?? "signup";
  const isRecovery = type === "recovery";

  // Куда вести при успехе/неудаче.
  const okDest = isRecovery
    ? "/update-password"
    : url.searchParams.get("next") ?? "/data-sources";
  const failDest = isRecovery
    ? "/reset-password?notice=link"
    : "/login?notice=confirm";

  if (!tokenHash) {
    return NextResponse.redirect(new URL(failDest, url.origin));
  }

  try {
    const supabase = createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (error) {
      return NextResponse.redirect(new URL(failDest, url.origin));
    }
    // Сессия записана в cookies → пользователь уже залогинен. Ведём в сервис.
    return NextResponse.redirect(new URL(okDest, url.origin));
  } catch {
    return NextResponse.redirect(new URL(failDest, url.origin));
  }
}
