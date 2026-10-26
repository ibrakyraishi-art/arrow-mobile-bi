import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getAuthenticatedSupabase } from "@/lib/server-auth";

/**
 * Email администратора. Источник истины — серверная переменная окружения
 * `ADMIN_EMAIL`. Если она не задана — админа нет, админка закрыта для всех
 * (реальный гейт — серверная проверка email из ПРОВЕРЕННОЙ сессии, а не
 * скрытие кнопки в UI). Тот же email нужно указать в `public.is_admin()`
 * (supabase/migrations/017_admin_feedback.sql) — он используется в RLS.
 */
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "")
  .trim()
  .toLowerCase();

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!ADMIN_EMAIL) return false;
  return (email ?? "").trim().toLowerCase() === ADMIN_EMAIL;
}

/**
 * Возвращает `{ supabase, user }`, если ТЕКУЩАЯ проверенная сессия принадлежит
 * админу, иначе `null` (роут должен ответить 403). `supabase` — RLS-клиент
 * пользователя: под политикой `is_admin()` он видит все заявки, но НЕ может
 * выйти за рамки RLS. Проверка идёт по email из `getUser()` (подпись JWT
 * проверена), а не по роли в профиле и не по клиентскому флагу.
 */
export async function getAdmin(): Promise<
  { supabase: SupabaseClient; user: User } | null
> {
  const { supabase, user } = await getAuthenticatedSupabase();
  if (!user || !isAdminEmail(user.email)) return null;
  return { supabase, user };
}
