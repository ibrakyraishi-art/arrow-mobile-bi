import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encryption";
export {
  friendlyClickhouseError,
  normalizeClickhouseErrorMessage,
} from "@/lib/clickhouse-errors";

export interface ResolvedSourceCreds {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export type ResolvedSource =
  | { ok: true; creds: ResolvedSourceCreds }
  | { ok: false; status: number; error: string };

/**
 * Загружает реальный (не демо) источник из Supabase по id под текущей
 * сессией пользователя (RLS гарантирует доступ только к своим источникам)
 * и расшифровывает пароль через серверный ENCRYPTION_KEY.
 *
 * Все ошибки нормализуются в понятные русские сообщения с подходящим
 * HTTP-статусом, чтобы клиент мог сразу показать toast.
 */
export async function resolveDataSource(
  supabase: SupabaseClient,
  id: string,
): Promise<ResolvedSource> {
  const { data, error } = await supabase
    .from("data_sources")
    .select("host, port, database_name, username, password_encrypted, ssl")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      status: 500,
      error: `Не удалось загрузить источник из Supabase: ${error.message}`,
    };
  }
  if (!data) {
    return {
      ok: false,
      status: 404,
      error: "Источник не найден или нет доступа",
    };
  }
  let password: string;
  try {
    password = decrypt((data.password_encrypted as string | null) ?? "");
  } catch {
    return {
      ok: false,
      status: 500,
      error:
        "Не удалось расшифровать пароль. Возможно изменился ENCRYPTION_KEY — переподключите источник.",
    };
  }
  return {
    ok: true,
    creds: {
      host: data.host as string,
      port: data.port as number,
      database: data.database_name as string,
      user: data.username as string,
      password,
      ssl: Boolean(data.ssl),
    },
  };
}
