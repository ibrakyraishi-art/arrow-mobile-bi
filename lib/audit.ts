import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditAction =
  | "login"
  | "logout"
  | "data_source_created"
  | "data_source_deleted"
  | "dataset_created"
  | "dataset_deleted"
  | "ai_analysis_run"
  | "api_key_updated"
  | "password_changed"
  | "telegram_connection_created"
  | "telegram_connection_deleted"
  | "telegram_connection_tested"
  | "notification_template_created"
  | "notification_template_deleted"
  | "alert_rule_created"
  | "alert_rule_updated"
  | "alert_rule_deleted"
  | "alert_rule_run"
  | "alert_rules_generated"
  | "alert_rule_refined";

export interface AuditEntry {
  id: string;
  userId: string;
  action: AuditAction;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditLogRow {
  id: string;
  user_id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

function rowToEntry(row: AuditLogRow): AuditEntry {
  return {
    id: row.id,
    userId: row.user_id,
    action: (row.action as AuditAction) ?? "login",
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    details: row.details,
    createdAt: row.created_at,
  };
}

/**
 * Записывает событие в `audit_log`. Принимает любой Supabase-клиент:
 * браузерный или серверный. Insert проходит через RLS (требует
 * `auth.uid() = user_id`). Все ошибки проглатываются — аудит никогда
 * не должен ломать основной поток.
 */
export async function logAudit(
  supabase: SupabaseClient,
  userId: string,
  action: AuditAction,
  resourceType: string | null = null,
  resourceId: string | null = null,
  details: Record<string, unknown> | null = null,
): Promise<void> {
  try {
    await supabase.from("audit_log").insert({
      user_id: userId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      details,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[audit] failed to log", action, e);
  }
}

/**
 * Загружает последние записи журнала текущего пользователя.
 * RLS отдаёт только записи `auth.uid() = user_id`.
 */
export async function getAuditLog(
  supabase: SupabaseClient,
  limit = 20,
): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data as AuditLogRow[] | null) ?? []).map(rowToEntry);
}

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  login: "Вход в систему",
  logout: "Выход из системы",
  data_source_created: "Создан источник данных",
  data_source_deleted: "Удалён источник данных",
  dataset_created: "Создан датасет",
  dataset_deleted: "Удалён датасет",
  ai_analysis_run: "Запущен AI-анализ",
  api_key_updated: "Обновлён API-ключ",
  password_changed: "Изменён пароль",
  telegram_connection_created: "Создано Telegram-подключение",
  telegram_connection_deleted: "Удалено Telegram-подключение",
  telegram_connection_tested: "Тест Telegram-подключения",
  notification_template_created: "Создан шаблон уведомления",
  notification_template_deleted: "Удалён шаблон уведомления",
  alert_rule_created: "Создано правило оповещений",
  alert_rule_updated: "Обновлено правило оповещений",
  alert_rule_deleted: "Удалено правило оповещений",
  alert_rule_run: "Запуск правила оповещений",
  alert_rules_generated: "Сгенерированы правила через AI",
  alert_rule_refined: "Доработка AI-правила",
};
