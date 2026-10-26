import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase";

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * Клиент с service-role: обходит RLS. Нужен для Vercel Cron и прочих
 * безсессионных задач — не использовать в пользовательских API с обычными cookies.
 */
export function createServiceRoleSupabaseClient(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
      "Service-role Supabase: задайте NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Серверный Supabase-клиент, читающий сессию из cookies запроса.
 * Используется в App Router route handlers для аутентифицированных
 * запросов: получает контекст пользователя, чтобы все обращения к БД
 * проходили под его RLS-правами.
 */
export function createServerSupabaseClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase не сконфигурирован: задайте NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  const cookieStore = cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Route handler в read-only контексте — просто игнорируем.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // см. выше
        }
      },
    },
  });
}

/**
 * Возвращает текущего пользователя из сессии Supabase или `null`.
 * Любая ошибка трактуется как отсутствие сессии.
 */
export async function getAuthenticatedUser(): Promise<User | null> {
  const { user } = await getAuthenticatedSupabase();
  return user;
}

/**
 * Один экземпляр server Supabase-клиента на запрос и пользователь из JWT.
 * Для Route Handlers, где после `getUser()` идут операции к БД под RLS —
 * нужен тот же клиент (один источник cookies / токена).
 */
export async function getAuthenticatedSupabase(): Promise<{
  supabase: SupabaseClient;
  user: User | null;
}> {
  const supabase = createServerSupabaseClient();
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return { supabase, user: null };
    return { supabase, user: data.user };
  } catch {
    return { supabase, user: null };
  }
}
