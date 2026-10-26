import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calcNextRunAt,
  executeRule,
  extractReferencedRuleNames,
  type ExecuteRuleInput,
  type ExecuteRuleResult,
} from "@/lib/alert-engine";
import { normalizeParseMode, rowToRule } from "@/lib/alert-rules-helpers";
import { DEMO_DATASET_ID, buildDemoDataset } from "@/lib/demo-data";
import { normalizeDatasetColumnsFromStorage } from "@/lib/supabase-db";
import type {
  AlertRule,
  Dataset,
  DatasetColumn,
  TelegramConnection,
} from "@/lib/types";

export const DEMO_DATASET_ID_ALERTS = DEMO_DATASET_ID;

/** Демо-датасет для алертов — тот же, что в сторе (lib/demo-data.ts). */
export function buildDemoDatasetForAlerts(): Dataset {
  return buildDemoDataset(new Date());
}

export type PrepareExecuteInputFail = { ok: false; error: string };

export async function loadExecuteRuleInput(
  supabase: SupabaseClient,
  rule: AlertRule,
  opts: {
    userId: string;
    userEmail: string;
    /**
     * Разрешить отсутствие Telegram-подключения / шаблона (для dry-run превью
     * таблицы, когда «Доставка» ещё не заполнена). В Telegram при dry-run всё
     * равно ничего не уходит. По умолчанию false — реальный запуск требует оба.
     */
    allowMissingDelivery?: boolean;
    /** Глубина рекурсии для ссылок {table:Имя} (защита от циклов). Внутреннее. */
    _depth?: number;
  },
): Promise<
  { ok: true; input: ExecuteRuleInput } | PrepareExecuteInputFail
> {
  const allowMissing = opts.allowMissingDelivery === true;
  const depth = opts._depth ?? 0;
  const stubConnection = (): TelegramConnection & { tokenEncrypted: string } => ({
    id: "",
    name: "",
    botUsername: "",
    chatId: "",
    chatTitle: "",
    isVerified: false,
    lastTestStatus: "unknown",
    createdAt: new Date().toISOString(),
    tokenEncrypted: "",
  });
  let dataset: Dataset;
  if (rule.datasetId === DEMO_DATASET_ID_ALERTS) {
    dataset = buildDemoDatasetForAlerts();
  } else {
    const { data: dsRow, error: dsErr } = await supabase
      .from("datasets")
      .select("*")
      .eq("id", rule.datasetId)
      .maybeSingle();
    if (dsErr) {
      return {
        ok: false,
        error: `Не удалось загрузить датасет: ${dsErr.message}`,
      };
    }
    if (!dsRow) {
      return { ok: false, error: "Привязанный датасет не найден" };
    }
    const r = dsRow as Record<string, unknown>;
    dataset = {
      id: r.id as string,
      name: (r.name as string) ?? "",
      dataSourceId: (r.data_source_id as string) ?? "",
      table: (r.table_name as string | null) ?? null,
      sqlQuery: (r.sql_query as string | null) ?? null,
      columns: normalizeDatasetColumnsFromStorage(
        Array.isArray(r.columns) ? (r.columns as DatasetColumn[]) : [],
      ),
      createdAt: (r.created_at as string) ?? new Date().toISOString(),
      rowCount: typeof r.row_count === "number" ? r.row_count : undefined,
      calculatedFields: Array.isArray(r.calculated_fields)
        ? (r.calculated_fields as Dataset["calculatedFields"])
        : [],
      businessContext: (r.business_context as string | null) ?? "",
      kpiProfile:
        r.kpi_profile && typeof r.kpi_profile === "object"
          ? (r.kpi_profile as Dataset["kpiProfile"])
          : {},
      funnelSteps: Array.isArray(r.funnel_steps)
        ? (r.funnel_steps as Dataset["funnelSteps"])
        : undefined,
    };
  }

  let connection: TelegramConnection & { tokenEncrypted: string };
  if (!rule.telegramConnectionId) {
    if (!allowMissing) {
      return { ok: false, error: "Не выбрано Telegram-подключение" };
    }
    connection = stubConnection();
  } else {
    const { data: connRow, error: connErr } = await supabase
      .from("telegram_connections")
      .select(
        "id, name, bot_username, bot_token_encrypted, chat_id, chat_title, is_verified, last_test_at, last_test_status, last_test_error, created_at",
      )
      .eq("id", rule.telegramConnectionId)
      .maybeSingle();
    if (connErr) {
      return {
        ok: false,
        error: `Не удалось загрузить Telegram-подключение: ${connErr.message}`,
      };
    }
    if (!connRow) {
      if (!allowMissing) {
        return { ok: false, error: "Привязанное Telegram-подключение не найдено" };
      }
      connection = stubConnection();
    } else {
      const c = connRow as Record<string, unknown>;
      connection = {
        id: c.id as string,
        name: (c.name as string) ?? "",
        botUsername: (c.bot_username as string) ?? "",
        chatId: (c.chat_id as string) ?? "",
        chatTitle: (c.chat_title as string) ?? "",
        isVerified: c.is_verified === true,
        lastTestAt: (c.last_test_at as string | null) ?? undefined,
        lastTestStatus:
          c.last_test_status === "ok" || c.last_test_status === "error"
            ? c.last_test_status
            : "unknown",
        lastTestError: (c.last_test_error as string | null) ?? undefined,
        createdAt: (c.created_at as string) ?? new Date().toISOString(),
        tokenEncrypted: (c.bot_token_encrypted as string) ?? "",
      };
    }
  }

  let templateBody = "";
  let templateParseMode = normalizeParseMode(undefined);
  if (!rule.templateId) {
    if (!allowMissing) {
      return { ok: false, error: "Не выбран шаблон сообщения" };
    }
  } else {
    const { data: tplRow, error: tplErr } = await supabase
      .from("notification_templates")
      .select("id, name, body, parse_mode")
      .eq("id", rule.templateId)
      .maybeSingle();
    if (tplErr) {
      return { ok: false, error: `Не удалось загрузить шаблон: ${tplErr.message}` };
    }
    if (!tplRow) {
      if (!allowMissing) {
        return { ok: false, error: "Привязанный шаблон не найден" };
      }
    } else {
      templateBody =
        typeof (tplRow as { body?: string }).body === "string"
          ? ((tplRow as { body: string }).body ?? "")
          : "";
      templateParseMode = normalizeParseMode(
        (tplRow as { parse_mode?: unknown }).parse_mode,
      );
    }
  }

  // Ссылки на таблицы других правил: {table:Имя правила}. Считаем их таблицы
  // (dry-run) и кладём в extraTables. Один уровень вложенности (depth<1),
  // чтобы не уйти в рекурсию, если правила ссылаются друг на друга.
  let extraTables: Record<string, string> | undefined;
  const refNames =
    depth < 1 ? extractReferencedRuleNames(templateBody) : [];
  if (refNames.length > 0) {
    extraTables = {};
    const { data: refRows } = await supabase
      .from("alert_rules")
      .select("*")
      .eq("user_id", opts.userId)
      .in("name", refNames);
    for (const refRow of refRows ?? []) {
      const refRule = rowToRule(refRow as Record<string, unknown>);
      if (refRule.id === rule.id) continue; // не считаем себя дважды
      try {
        const prep = await loadExecuteRuleInput(supabase, refRule, {
          userId: opts.userId,
          userEmail: opts.userEmail,
          allowMissingDelivery: true,
          _depth: depth + 1,
        });
        if (!prep.ok) {
          extraTables[refRule.name] = `(не удалось посчитать: ${prep.error})`;
          continue;
        }
        const res = await executeRule(supabase, { ...prep.input, dryRun: true });
        extraTables[refRule.name] =
          res.status === "no_match"
            ? "(нет строк)"
            : res.table && res.table.trim()
              ? res.table
              : res.errorText
                ? `(ошибка: ${res.errorText})`
                : "(пусто)";
      } catch (e) {
        extraTables[refRule.name] =
          `(ошибка: ${e instanceof Error ? e.message : String(e)})`;
      }
    }
  }

  return {
    ok: true,
    input: {
      rule,
      dataset,
      connection,
      templateBody,
      templateParseMode,
      userEmail: opts.userEmail ?? "",
      extraTables,
    },
  };
}

export async function persistAlertExecutionResult(
  supabase: SupabaseClient,
  args: {
    userId: string;
    rule: AlertRule;
    result: ExecuteRuleResult;
    createdAtIso?: string;
    /** Кто/что инициировало запуск. По умолчанию manual. */
    triggeredBy?: "manual" | "cron" | "trigger";
  },
): Promise<{ run: Record<string, unknown> | null }> {
  const nowIso = args.createdAtIso ?? new Date().toISOString();
  const { userId, rule, result } = args;

  // Имена колонок ДОЛЖНЫ совпадать со схемой alert_runs в Supabase:
  // matches_count (не matched_count!), message_sent (не message!),
  // triggered_by. rule_name/used_ai в схеме нет — rule_name берётся
  // через JOIN в GET /api/alert-runs, used_ai = (ai_recommendation IS NOT NULL).
  const { data: runData, error: runErr } = await supabase
    .from("alert_runs")
    .insert({
      user_id: userId,
      rule_id: rule.id,
      status: result.status,
      matches_count: result.matchedCount,
      matched_objects: result.matchedObjects,
      message_sent: result.message,
      ai_recommendation: result.aiRecommendation ?? null,
      duration_ms: result.durationMs,
      error_text: result.errorText ?? null,
      triggered_by: args.triggeredBy ?? "manual",
      created_at: nowIso,
    })
    .select("*")
    .single();
  if (runErr) {
    console.error("[persistAlertExecutionResult] alert_runs insert:", runErr.message);
  }

  const { error: ruleUpdErr } = await supabase
    .from("alert_rules")
    .update({
      last_run_at: nowIso,
      last_run_status: result.status,
      last_run_message:
        result.status === "error"
          ? result.errorText ?? "Ошибка"
          : result.status === "no_match"
            ? "Нет матчей"
            : `Отправлено объектов: ${result.matchedCount}`,
      next_run_at: calcNextRunAt(rule.schedule, new Date()) ?? null,
    })
    .eq("id", rule.id);
  if (ruleUpdErr) {
    console.error("[persistAlertExecutionResult] alert_rules update:", ruleUpdErr.message);
  }

  return { run: runData ?? null };
}
