import "server-only";
import type {
  AIModelId,
  AlertAnalysisConfig,
  AlertCondition,
  AlertConditionOperator,
  AlertCreatedBy,
  AlertRule,
  AlertScheduleType,
  ScheduleConfig,
  TelegramParseMode,
} from "@/lib/types";
import {
  normalizeAlertCondition,
  normalizeAnalysisConfig,
  normalizeRuleGroupBy,
  serializeRuleGroupBy,
} from "@/lib/types";

/** Фиксированный часовой пояс всех правил (по требованию продукта). */
const FIXED_TIMEZONE = "Europe/Moscow";

const VALID_OPERATORS: AlertConditionOperator[] = ["<", ">", "<=", ">=", "="];
const VALID_SCHEDULE_TYPES: AlertScheduleType[] = [
  "daily",
  "weekly",
  "twice_weekly",
  "every_n_hours",
  "trigger_only",
];
const VALID_MODELS: AIModelId[] = ["haiku", "sonnet", "opus"];

export function normalizeConditions(input: unknown): AlertCondition[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((raw) => raw && typeof raw === "object")
    .map((raw) => normalizeAlertCondition(raw))
    .filter((c) => c.metric);
}

export function normalizeSchedule(input: unknown): ScheduleConfig {
  const fallback: ScheduleConfig = {
    type: "daily",
    time: "09:00",
    timezone: FIXED_TIMEZONE,
  };
  if (!input || typeof input !== "object") return fallback;
  const r = input as Record<string, unknown>;
  const type = VALID_SCHEDULE_TYPES.includes(r.type as AlertScheduleType)
    ? (r.type as AlertScheduleType)
    : "daily";
  const out: ScheduleConfig = {
    type,
    // Часовой пояс зафиксирован на Москве — игнорируем входное значение.
    timezone: FIXED_TIMEZONE,
  };
  if (typeof r.time === "string" && /^\d{1,2}:\d{2}$/.test(r.time)) {
    out.time = r.time;
  }
  if (Array.isArray(r.daysOfWeek)) {
    out.daysOfWeek = (r.daysOfWeek as unknown[])
      .map((d) => Number(d))
      .filter((d) => Number.isFinite(d) && d >= 0 && d <= 6);
  }
  if (typeof r.intervalHours === "number" && Number.isFinite(r.intervalHours)) {
    out.intervalHours = Math.max(1, Math.floor(r.intervalHours));
  }
  return out;
}

/**
 * Собирает ScheduleConfig из БД-строки. В `alert_rules` расписание
 * хранится тремя колонками: `schedule_type` (text), `schedule_config` (jsonb
 * с `time`/`daysOfWeek`/`intervalHours`), `timezone` (text). Старый код
 * писал единое поле `schedule` — оставляем как fallback, если столбец
 * каким-то клиентом всё-таки прилетит.
 */
function rowToSchedule(row: Record<string, unknown>): ScheduleConfig {
  if (row.schedule && typeof row.schedule === "object") {
    return normalizeSchedule(row.schedule);
  }
  const cfg =
    row.schedule_config && typeof row.schedule_config === "object"
      ? (row.schedule_config as Record<string, unknown>)
      : {};
  return normalizeSchedule({
    type: row.schedule_type,
    timezone: row.timezone,
    time: cfg.time,
    daysOfWeek: cfg.daysOfWeek,
    intervalHours: cfg.intervalHours,
  });
}

/** Разбивает ScheduleConfig на 3 колонки БД. */
function scheduleToColumns(schedule: ScheduleConfig): {
  schedule_type: AlertScheduleType;
  schedule_config: Record<string, unknown>;
  timezone: string;
} {
  const cfg: Record<string, unknown> = {};
  if (schedule.time) cfg.time = schedule.time;
  if (Array.isArray(schedule.daysOfWeek))
    cfg.daysOfWeek = schedule.daysOfWeek;
  if (typeof schedule.intervalHours === "number")
    cfg.intervalHours = schedule.intervalHours;
  return {
    schedule_type: schedule.type,
    schedule_config: cfg,
    timezone: FIXED_TIMEZONE,
  };
}

export function normalizeModel(v: unknown): AIModelId | undefined {
  return typeof v === "string" && VALID_MODELS.includes(v as AIModelId)
    ? (v as AIModelId)
    : undefined;
}

export function normalizeCreatedBy(v: unknown): AlertCreatedBy {
  return v === "ai" ? "ai" : "manual";
}

/**
 * Нормализация режима парсинга из БД/клиента.
 * По умолчанию — MarkdownV2, если явно не задано или не распознано.
 */
export function normalizeParseMode(v: unknown): TelegramParseMode {
  if (v === null || v === undefined || String(v).trim() === "") {
    return "markdownv2";
  }
  const raw = String(v).trim().toLowerCase().replace(/\s+/g, "");
  const aliases: Record<string, TelegramParseMode> = {
    none: "none",
    plain: "none",
    markdown: "markdown",
    legacy: "markdown",
    md: "markdown",
    markdownv2: "markdownv2",
    markdown_v2: "markdownv2",
    html: "html",
  };
  if (aliases[raw]) return aliases[raw];
  return "markdownv2";
}

/** Применимо к PATCH тел шаблонов: `undefined` означает «не менять». */
export function normalizeParseModeFromOptional(
  v: string | undefined,
): TelegramParseMode | null {
  if (v === undefined) return null;
  return normalizeParseMode(v);
}

export function rowToRule(row: Record<string, unknown>): AlertRule {
  const conds = normalizeConditions(row.conditions);
  return {
    id: row.id as string,
    name: (row.name as string) ?? "",
    description: (row.description as string | null) ?? undefined,
    isActive: row.is_active === true,
    createdBy: normalizeCreatedBy(row.created_by),
    aiMeta:
      row.ai_meta && typeof row.ai_meta === "object"
        ? (row.ai_meta as AlertRule["aiMeta"])
        : undefined,
    datasetId: (row.dataset_id as string) ?? "",
    groupBy: normalizeRuleGroupBy(row.group_by),
    periodDays: Number(row.period_days) || 1,
    minSpendFilter:
      typeof row.min_spend_filter === "number"
        ? row.min_spend_filter
        : row.min_spend_filter === null || row.min_spend_filter === undefined
          ? undefined
          : Number(row.min_spend_filter),
    conditions: conds,
    telegramConnectionId: (row.telegram_connection_id as string) ?? "",
    templateId: (row.template_id as string) ?? "",
    tagUsers: (row.tag_users as string | null) ?? undefined,
    useAiRecommendation: row.use_ai_recommendation === true,
    aiModel: normalizeModel(row.ai_model),
    schedule: rowToSchedule(row),
    analysis: normalizeAnalysisConfig(row.analysis_config),
    lastRunAt: (row.last_run_at as string | null) ?? undefined,
    lastRunStatus:
      row.last_run_status === "ok" ||
      row.last_run_status === "error" ||
      row.last_run_status === "no_match"
        ? row.last_run_status
        : undefined,
    lastRunMessage: (row.last_run_message as string | null) ?? undefined,
    nextRunAt: (row.next_run_at as string | null) ?? undefined,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
  };
}

export interface RulePayload {
  name: string;
  description?: string;
  isActive?: boolean;
  createdBy?: AlertCreatedBy;
  aiMeta?: AlertRule["aiMeta"];
  datasetId: string;
  /** Колонки группировки (одна или несколько). */
  groupBy: string[];
  periodDays: number;
  minSpendFilter?: number | null;
  conditions: AlertCondition[];
  telegramConnectionId: string;
  templateId: string;
  tagUsers?: string;
  useAiRecommendation?: boolean;
  aiModel?: AIModelId;
  schedule: ScheduleConfig;
  analysis?: AlertAnalysisConfig;
}

export function ruleToInsert(
  userId: string,
  payload: RulePayload,
  nextRunAt?: string,
): Record<string, unknown> {
  return {
    user_id: userId,
    name: payload.name,
    description: payload.description ?? null,
    is_active: payload.isActive !== false,
    created_by: payload.createdBy ?? "manual",
    ai_meta: payload.aiMeta ?? null,
    dataset_id: payload.datasetId,
    group_by: serializeRuleGroupBy(payload.groupBy),
    period_days: Math.max(1, Math.floor(payload.periodDays)),
    min_spend_filter:
      typeof payload.minSpendFilter === "number"
        ? payload.minSpendFilter
        : null,
    conditions: payload.conditions,
    telegram_connection_id: payload.telegramConnectionId || null,
    template_id: payload.templateId || null,
    tag_users: payload.tagUsers ?? null,
    use_ai_recommendation: payload.useAiRecommendation === true,
    ai_model: payload.aiModel ?? null,
    ...scheduleToColumns(payload.schedule),
    analysis_config: payload.analysis
      ? normalizeAnalysisConfig(payload.analysis)
      : {},
    next_run_at: nextRunAt ?? null,
    created_at: new Date().toISOString(),
  };
}

export function rulePatchToUpdate(
  patch: Partial<RulePayload> & { nextRunAt?: string | null },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.description !== undefined)
    out.description = patch.description ?? null;
  if (patch.isActive !== undefined) out.is_active = patch.isActive;
  if (patch.datasetId !== undefined) out.dataset_id = patch.datasetId;
  if (patch.groupBy !== undefined)
    out.group_by = serializeRuleGroupBy(patch.groupBy);
  if (patch.periodDays !== undefined)
    out.period_days = Math.max(1, Math.floor(patch.periodDays));
  if (patch.minSpendFilter !== undefined)
    out.min_spend_filter =
      typeof patch.minSpendFilter === "number" ? patch.minSpendFilter : null;
  if (patch.conditions !== undefined) out.conditions = patch.conditions;
  if (patch.telegramConnectionId !== undefined)
    out.telegram_connection_id = patch.telegramConnectionId || null;
  if (patch.templateId !== undefined) out.template_id = patch.templateId || null;
  if (patch.tagUsers !== undefined) out.tag_users = patch.tagUsers ?? null;
  if (patch.useAiRecommendation !== undefined)
    out.use_ai_recommendation = patch.useAiRecommendation === true;
  if (patch.aiModel !== undefined) out.ai_model = patch.aiModel ?? null;
  if (patch.schedule !== undefined) {
    Object.assign(out, scheduleToColumns(patch.schedule));
  }
  if (patch.analysis !== undefined)
    out.analysis_config = patch.analysis
      ? normalizeAnalysisConfig(patch.analysis)
      : {};
  if (patch.aiMeta !== undefined) out.ai_meta = patch.aiMeta ?? null;
  if (patch.nextRunAt !== undefined) out.next_run_at = patch.nextRunAt ?? null;
  // Метка изменения: нет БД-триггера moddatetime для alert_rules, поэтому
  // обновляем явно при каждом PATCH.
  out.updated_at = new Date().toISOString();
  return out;
}
