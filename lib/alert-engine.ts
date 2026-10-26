import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aggregate,
  applyFilters,
  valueKey,
  type AggregateCalcField,
} from "@/lib/aggregation";
import {
  escapeSql,
  quoteIdent,
  runClickhouseQuery,
} from "@/lib/clickhouse";
import {
  computeAggregateFlags,
  enrichRowsWithCalculated,
  evaluateAggregateFormula,
  formulaToSql,
  prepareCalculatedFields,
  resolveCalcRefs,
  topoSortCalculatedFields,
  type PreparedField,
} from "@/lib/formula";
import {
  buildAdvancedSql,
  desugarConditions,
  evaluateAdvancedDemo,
  hasAdvancedConditions,
  metricAggSql,
  metricRowExprSql,
  placeholderNamesFor,
  valueFiltersToSqlWhere,
  type DemoMetricFn,
} from "@/lib/alert-conditions";
import {
  DEMO_DATASET_ID,
  DEMO_SOURCE_ID,
  DEMO_TABLE,
  getDemoData,
} from "@/lib/demo-data";
import { loadFileSource } from "@/lib/file-source-server";
import { decrypt } from "@/lib/encryption";
import {
  friendlyClickhouseError,
  resolveDataSource,
} from "@/lib/data-source-server";
import { formatCalculatedValue } from "@/lib/format-value";
import type {
  AggregationType,
  AlertCondition,
  AlertConditionOperator,
  AlertRule,
  AlertRun,
  CalculatedFieldFormat,
  Dataset,
  PivotValueConfig,
  QueryResultRow,
  ScheduleConfig,
  TelegramConnection,
  TelegramParseMode,
} from "@/lib/types";
import { normalizeAlertCondition } from "@/lib/types";

/** Условие, после desugar+normalize гарантированно threshold-формы. */
function thresholdConditionsOf(conditions: AlertCondition[]): Array<{
  metric: string;
  operator: AlertConditionOperator;
  value: number;
}> {
  return conditions.flatMap((c) =>
    !c.kind || c.kind === "threshold"
      ? [{ metric: c.metric, operator: c.operator, value: c.value }]
      : [],
  );
}

// ---------------------------------------------------------------------------
// Расчёт следующего запуска по расписанию
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Следующая ISO-дата срабатывания правила. Часовой пояс из расписания
 * учитывается через `Intl.DateTimeFormat`. Расчёт упрощённый: нужен только
 * для отображения и подготовки к будущему cron'у. Для `trigger_only`
 * возвращает undefined.
 */
export function calcNextRunAt(
  schedule: ScheduleConfig,
  from: Date = new Date(),
): string | undefined {
  if (!schedule || schedule.type === "trigger_only") return undefined;
  const tz = schedule.timezone || "UTC";

  const tzNow = getZonedParts(from, tz);

  if (schedule.type === "every_n_hours") {
    const interval = Math.max(1, Math.floor(schedule.intervalHours ?? 1));
    return new Date(from.getTime() + interval * HOUR_MS).toISOString();
  }

  const [hours, minutes] = parseTime(schedule.time ?? "09:00");

  if (schedule.type === "daily") {
    return findNextRun(from, tz, [0, 1, 2, 3, 4, 5, 6], hours, minutes);
  }
  if (schedule.type === "weekly" || schedule.type === "twice_weekly") {
    const days =
      Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.length > 0
        ? schedule.daysOfWeek.map((d) => Math.min(6, Math.max(0, d)))
        : [tzNow.dayOfWeek];
    return findNextRun(from, tz, days, hours, minutes);
  }
  return undefined;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
}

function getZonedParts(d: Date, tz: string): ZonedParts {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
    const parts = fmt.formatToParts(d);
    const get = (t: string) =>
      parts.find((p) => p.type === t)?.value ?? "";
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return {
      year: Number(get("year")),
      month: Number(get("month")),
      day: Number(get("day")),
      hour: Number(get("hour")),
      minute: Number(get("minute")),
      dayOfWeek: weekdayMap[get("weekday")] ?? 0,
    };
  } catch {
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      dayOfWeek: d.getUTCDay(),
    };
  }
}

function parseTime(s: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return [9, 0];
  return [
    Math.min(23, Math.max(0, Number(m[1]))),
    Math.min(59, Math.max(0, Number(m[2]))),
  ];
}

/**
 * Момент в UTC, у которого «настенное» время в зоне `tz` равно
 * `y-mo-d hh:mi`. Приём: берём наивный UTC из этих компонентов и
 * корректируем на смещение зоны в этот момент. Одной итерации хватает для
 * зон с фиксированным смещением (Москва — UTC+3, без перехода на летнее
 * время); для зон с DST возможна ошибка ±1 час в момент перевода стрелок.
 */
function zonedWallTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
): Date {
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  const z = getZonedParts(new Date(naiveUtc), tz);
  const wallAsUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, 0);
  const offset = wallAsUtc - naiveUtc; // смещение зоны относительно UTC (мс)
  return new Date(naiveUtc - offset);
}

/**
 * Ближайший в будущем момент, соответствующий заданным дням недели и времени
 * (HH:MM) в указанной таймзоне. Перебираем КАЛЕНДАРНЫЕ дни в зоне и для
 * каждого считаем точный момент целевого времени — поэтому целевая минута
 * соблюдается ТОЧНО и не зависит от того, в какую минуту вызвали расчёт
 * (прежняя версия шагала по часам и «замораживала» минуту = текущей, из-за
 * чего 09:00-правило уезжало на фоллбэк «сейчас + 24ч»).
 */
function findNextRun(
  from: Date,
  tz: string,
  daysOfWeek: number[],
  targetHour: number,
  targetMinute: number,
): string | undefined {
  const set = new Set(daysOfWeek);
  for (let i = 0; i <= 14; i += 1) {
    const probe = getZonedParts(new Date(from.getTime() + i * DAY_MS), tz);
    if (!set.has(probe.dayOfWeek)) continue;
    const candidate = zonedWallTimeToUtc(
      probe.year,
      probe.month,
      probe.day,
      targetHour,
      targetMinute,
      tz,
    );
    if (candidate.getTime() > from.getTime()) {
      return candidate.toISOString();
    }
  }
  // Грубый фоллбэк: завтра в это же время (на практике не достигается).
  return new Date(from.getTime() + DAY_MS).toISOString();
}

// ---------------------------------------------------------------------------
// Подстановка переменных в шаблон
// ---------------------------------------------------------------------------

// Обычные переменные: {name}. Плюс ссылка на таблицу другого правила:
// {table:Имя правила} — имя может содержать пробелы, кириллицу, цифры и т.п.
const VAR_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*(?::[^{}]+)?)\}/g;

/** Извлекает имена правил из всех `{table:Имя}` в теле шаблона. */
export function extractReferencedRuleNames(body: string): string[] {
  const out = new Set<string>();
  const re = /\{table:([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const name = m[1].trim();
    if (name) out.add(name);
  }
  return Array.from(out);
}

export interface TemplateContext {
  variables: Record<string, string>;
}

/**
 * Подставляет в текст шаблона значения из `variables`. Неизвестные
 * переменные оставляет как есть (например, `{unknown}`), чтобы юзер
 * сразу заметил опечатку.
 */
export function renderTemplate(
  body: string,
  ctx: TemplateContext,
): string {
  return body.replace(VAR_RE, (full, name: string) => {
    const v = ctx.variables[name];
    return typeof v === "string" ? v : full;
  });
}

/** Минимальное MarkdownV2-экранирование для значений переменных. */
export function escapeMarkdownV2(s: string): string {
  return s.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

/** Экранирование значений переменных для legacy Markdown («Markdown» Telegram). */
export function escapeMarkdownClassic(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/([_[\]*`])/g, "\\$1");
}

function escapeHtmlPlain(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Выполнение правила
// ---------------------------------------------------------------------------

export interface ExecuteRuleInput {
  rule: AlertRule;
  dataset: Dataset;
  connection: TelegramConnection & { tokenEncrypted: string };
  templateBody: string;
  templateParseMode: TelegramParseMode;
  userEmail: string;
  /**
   * Готовые таблицы других правил для ссылок `{table:Имя правила}`.
   * Ключ — имя правила, значение — готовый текст таблицы (без code-fence;
   * движок обернёт его под parse_mode так же, как основной {table}).
   * Заполняется в `loadExecuteRuleInput`.
   */
  extraTables?: Record<string, string>;
  /**
   * Dry-run: вычислить матчи + отрендерить шаблон, но НЕ отправлять
   * в Telegram. Используется превью в UI создания/редактирования правила.
   */
  dryRun?: boolean;
}

export interface ExecuteRuleResult {
  status: "ok" | "error" | "no_match";
  matchedCount: number;
  matchedObjects: QueryResultRow[];
  message: string;
  aiRecommendation?: string;
  usedAi: boolean;
  durationMs: number;
  errorText?: string;
  /**
   * Готовая сводная таблица в виде моноширинного текста (без code-fence) —
   * как она подставляется в {table}. Для UI-превью таблицы.
   */
  table?: string;
  /** Структурированная таблица (колонки + строки) — для интерактивного превью. */
  tableData?: PivotTableData;
}

/**
 * Имя столбца/таблицы безопасно для подстановки в SQL: движок ВСЕГДА оборачивает
 * его в обратные кавычки (`quoteIdent` удваивает бэктики), поэтому реальные имена
 * колонок ClickHouse с пробелами, точками, скобками и кириллицей (например
 * «Attribution type» или «…subscription.purchase.completed») безопасны и должны
 * работать без раздумий пользователя. Блокируем лишь пустые/слишком длинные имена
 * и управляющие символы с обратным слэшем (возможные escape-последовательности).
 */
function isQuotableName(name: string): boolean {
  if (!name || name.length > 256) return false;
  for (let idx = 0; idx < name.length; idx++) {
    const c = name.charCodeAt(idx);
    // управляющие (0x00–0x1F), DEL (0x7F), обратный слэш (0x5C) — небезопасны
    if (c < 0x20 || c === 0x7f || c === 0x5c) return false;
  }
  return true;
}

/**
 * Собирает и выполняет SQL-выборку (или агрегирует демо-данные in-memory),
 * применяет условия как HAVING (или их аналог в JS), при необходимости
 * запрашивает AI-рекомендацию у Claude, рендерит шаблон сообщения и
 * отправляет его в Telegram. Возвращает структурированный результат —
 * route handler сохраняет его в `alert_runs` и обновляет `alert_rules`.
 */
export async function executeRule(
  supabase: SupabaseClient,
  input: ExecuteRuleInput,
): Promise<ExecuteRuleResult> {
  const t0 = Date.now();
  const { dataset, connection, templateBody, templateParseMode } = input;
  // Нормализуем условия (старые записи без `kind` → threshold; trend desugar).
  const conditions = desugarConditions(
    (input.rule.conditions ?? []).map(normalizeAlertCondition),
  );
  const rule: AlertRule = { ...input.rule, conditions };

  // 1. Проверяем имена. Никаких injection через group_by / metric / подгруппы.
  // Вычисляемые поля — это ЛЕЙБЛЫ (могут содержать пробелы, напр. «CPA total
  // subs»); они резолвятся в формулу через colExpr, в сырой SQL не попадают.
  // Поэтому валидируем как столбец только НЕ-calc имена.
  const calcFieldNames = new Set(
    (dataset.calculatedFields ?? []).map((f) => f.name),
  );
  const isRawCol = (name: string) => !calcFieldNames.has(name);
  if (rule.groupBy.length === 0) {
    return failed(t0, "Не задана группировка правила");
  }
  for (const g of rule.groupBy) {
    if (isRawCol(g) && !isQuotableName(g)) {
      return failed(t0, `Недопустимое имя группировки: ${g}`);
    }
  }
  for (const c of conditions) {
    if (isRawCol(c.metric) && !isQuotableName(c.metric)) {
      return failed(t0, `Недопустимое имя метрики: ${c.metric}`);
    }
    if (c.kind === "vs_group_avg") {
      for (const g of c.groupBy) {
        if (isRawCol(g) && !isQuotableName(g)) {
          return failed(t0, `Недопустимое имя столбца группировки: ${g}`);
        }
      }
    }
  }
  // Метрики таблицы и value-фильтры — те же правила (calc-имена пропускаем).
  for (const m of rule.analysis?.metrics ?? []) {
    if (m.column && isRawCol(m.column) && !isQuotableName(m.column)) {
      return failed(t0, `Недопустимое имя метрики: ${m.column}`);
    }
  }
  for (const f of rule.analysis?.valueFilters ?? []) {
    if (f.column && isRawCol(f.column) && !isQuotableName(f.column)) {
      return failed(t0, `Недопустимое имя поля фильтра: ${f.column}`);
    }
  }
  if (dataset.table && !isQuotableName(dataset.table)) {
    return failed(t0, `Недопустимое имя таблицы: ${dataset.table}`);
  }

  const isDemo =
    dataset.dataSourceId === DEMO_SOURCE_ID ||
    dataset.id === DEMO_DATASET_ID;
  const advanced = hasAdvancedConditions(conditions);

  // 2. Готовим выборку. Демо- и ФАЙЛОВЫЕ источники (CSV / Excel / Google Sheets)
  // считаются in-JS — ClickHouse у них нет. loadFileSource вернёт строки, если
  // источник файловый; иначе null → идём по ветке ClickHouse.
  let matched: QueryResultRow[];
  let placeholderColumns: string[] = [];
  let inMemoryRows: QueryResultRow[] | null = null;
  try {
    const fileSrc = isDemo
      ? null
      : await loadFileSource(supabase, dataset.dataSourceId);
    inMemoryRows = isDemo
      ? getDemoData()[dataset.table ?? DEMO_TABLE] ?? []
      : fileSrc
        ? fileSrc.rows
        : null;
    if (advanced) {
      const r = inMemoryRows
        ? evaluateAdvancedInMemory(dataset, rule, inMemoryRows)
        : await evaluateAdvancedClickhouse(supabase, dataset, rule);
      matched = r.matched;
      placeholderColumns = r.placeholderColumns;
    } else {
      const aggregated = inMemoryRows
        ? aggregateInMemory(dataset, rule, inMemoryRows)
        : await aggregateFromClickhouse(supabase, dataset, rule);
      matched = filterMatched(aggregated, rule);
    }
  } catch (e) {
    return failed(t0, e instanceof Error ? e.message : String(e));
  }

  if (matched.length === 0) {
    const ts = new Date().toISOString();
    const hint = emptyPeriodHint(dataset, rule, inMemoryRows);
    return {
      status: "no_match",
      matchedCount: 0,
      matchedObjects: [],
      message:
        hint ??
        `Нет объектов, удовлетворяющих условиям правила «${rule.name}» на ${ts}.`,
      usedAi: false,
      durationMs: Date.now() - t0,
    };
  }

  // 4. Сортировка + топ-N (конструктор анализа). matchedCount остаётся полным.
  const totalMatched = matched.length;
  const display = applySortAndLimit(matched, rule);

  // 5. Готовим сводную таблицу + переменные и рендерим тело сообщения.
  const tableData = buildTableData(display, rule, dataset) ?? undefined;
  const tablePlain = tableData ? renderTableDataText(tableData) : "";
  const variables = buildVariables({
    rule,
    dataset,
    matched: display,
    totalCount: totalMatched,
    placeholderColumns,
    userEmail: input.userEmail,
    parseMode: templateParseMode,
    tablePlain,
  });
  // Ссылки на таблицы других правил: {table:Имя} → их готовый текст,
  // обёрнутый под parse_mode так же, как основной {table}.
  for (const [ruleName, plain] of Object.entries(input.extraTables ?? {})) {
    variables[`table:${ruleName}`] = wrapTableForParseMode(
      plain,
      templateParseMode,
    );
  }
  // Ссылка на самого себя по имени ({table:СвоёИмя}) = своя же таблица.
  // Иначе self-reference остался бы «сырым» токеном (loader его пропускает,
  // чтобы не считать дважды). Имя берём как есть.
  if (rule.name) {
    variables[`table:${rule.name}`] = variables.table;
  }
  const rendered = renderTemplate(templateBody, { variables });

  // Dry-run: возвращаем готовое сообщение, в Telegram не идём.
  if (input.dryRun) {
    return {
      status: "ok",
      matchedCount: totalMatched,
      matchedObjects: display.slice(0, 50),
      message: rendered,
      table: tablePlain,
      tableData,
      usedAi: false,
      durationMs: Date.now() - t0,
    };
  }

  // 5. Отправляем в Telegram.
  let token: string;
  try {
    token = decrypt(connection.tokenEncrypted);
  } catch {
    return failed(
      t0,
      "Не удалось расшифровать bot_token — возможно, изменился ENCRYPTION_KEY.",
    );
  }

  const sendRes = await sendTelegramMessage({
    token,
    chatId: connection.chatId,
    text: rendered,
    parseMode: templateParseMode,
  });
  if (!sendRes.ok) {
    return {
      status: "error",
      matchedCount: totalMatched,
      matchedObjects: display.slice(0, 50),
      message: rendered,
      table: tablePlain,
      tableData,
      usedAi: false,
      durationMs: Date.now() - t0,
      errorText: sendRes.error,
    };
  }

  return {
    status: "ok",
    matchedCount: totalMatched,
    matchedObjects: display.slice(0, 50),
    message: rendered,
    table: tablePlain,
    tableData,
    usedAi: false,
    durationMs: Date.now() - t0,
  };
}

function failed(t0: number, errorText: string): ExecuteRuleResult {
  return {
    status: "error",
    matchedCount: 0,
    matchedObjects: [],
    message: "",
    usedAi: false,
    durationMs: Date.now() - t0,
    errorText,
  };
}

function buildAggregations(rule: AlertRule): PivotValueConfig[] {
  // Метрики, которые надо посчитать на уровне группы: (1) метрики из условий
  // (всегда SUM — так считает классический threshold-путь), плюс (2) display-
  // метрики конструктора анализа (с выбранной агрегацией) — чтобы они попали
  // в {table}. Дедуп по `valueKey` (агрегация+колонка), чтобы SUM(cost) из
  // условия и SUM(cost) из метрик не дублировались.
  const seen = new Set<string>();
  const out: PivotValueConfig[] = [];
  const add = (v: PivotValueConfig) => {
    const k = valueKey(v);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(v);
  };
  for (const c of rule.conditions) add({ column: c.metric, aggregation: "SUM" });
  for (const m of rule.analysis?.metrics ?? []) add(m);
  return out;
}

/**
 * Готовит вычисляемые поля датасета для расчёта правила: разбирает
 * формулы, определяет, какие из них aggregate-level, строит карту имя→AST
 * с уже разрешёнными ссылками calc→calc.
 */
function prepareDatasetCalc(dataset: Dataset) {
  const prepared = prepareCalculatedFields(dataset.calculatedFields ?? []);
  const preparedMap = new Map(prepared.map((p) => [p.field.name, p]));
  const aggFlags = computeAggregateFlags(prepared);
  const isCalc = (name: string) => preparedMap.has(name);
  const isAggCalc = (name: string) => aggFlags.get(name) === true;
  /** Резолвит ссылки calc→calc; возвращает плоский AST. */
  const resolvedAst = (name: string) => {
    const p = preparedMap.get(name);
    return p ? resolveCalcRefs(p.ast, preparedMap) : null;
  };
  return { prepared, preparedMap, aggFlags, isCalc, isAggCalc, resolvedAst };
}

function aggregateInMemory(
  dataset: Dataset,
  rule: AlertRule,
  allRows: QueryResultRow[],
): QueryResultRow[] {
  // Период: либо абсолютный диапазон дат (analysis.dateRange), либо последние N дней.
  const dateCol = pickDateColumn(dataset, rule.analysis?.dateColumn);
  const range = rule.analysis?.dateRange ?? null;
  const since = new Date();
  since.setDate(since.getDate() - rule.periodDays);
  const sinceStr = since.toISOString().slice(0, 10);
  const filtered = allRows.filter((r) => {
    if (!dateCol) return true;
    const d = r[dateCol];
    if (typeof d !== "string") return true;
    const day = d.slice(0, 10);
    return range ? day >= range.from && day <= range.to : day >= sinceStr;
  });

  // Вычисляемые поля: row-level — обогащают строки; aggregate-level —
  // считаются на уровне группы внутри aggregate().
  const calc = prepareDatasetCalc(dataset);
  const rowLevelOrdered: PreparedField[] = topoSortCalculatedFields(
    calc.prepared.filter((p) => !calc.isAggCalc(p.field.name)),
  );
  const enriched =
    rowLevelOrdered.length > 0
      ? enrichRowsWithCalculated(filtered, rowLevelOrdered)
      : filtered;
  const aggCalcFields: AggregateCalcField[] = calc.prepared
    .filter((p) => calc.isAggCalc(p.field.name))
    .map((p) => ({
      name: p.field.name,
      datasetType: p.field.datasetType,
      ast: resolveCalcRefs(p.ast, calc.preparedMap),
    }));
  // Value-фильтры (по значениям полей) применяем ДО агрегации. Aggregate-calc
  // поля на уровне строки не существуют — такие фильтры пропускаем.
  const vfiltered = applyFilters(
    enriched,
    (rule.analysis?.valueFilters ?? []).filter((f) => !calc.isAggCalc(f.column)),
  );
  return aggregate(
    vfiltered,
    rule.groupBy,
    buildAggregations(rule),
    aggCalcFields,
  );
}

async function aggregateFromClickhouse(
  supabase: SupabaseClient,
  dataset: Dataset,
  rule: AlertRule,
): Promise<QueryResultRow[]> {
  const resolved = await resolveDataSource(supabase, dataset.dataSourceId);
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }
  const creds = resolved.creds;

  const fromClause = dataset.sqlQuery
    ? `(${dataset.sqlQuery.trim().replace(/;$/, "")})`
    : dataset.table
      ? `${quoteIdent(creds.database)}.${quoteIdent(dataset.table)}`
      : null;
  if (!fromClause) {
    throw new Error("В датасете нет таблицы и нет SQL-запроса");
  }

  // Вычисляемые поля датасета: метрика/группировка может ссылаться на calc-поле.
  const calc = prepareDatasetCalc(dataset);
  // SQL-выражение для столбца/calc-поля (для groupBy и для аргумента sum()).
  const colExpr = (name: string): string => {
    const ast = calc.resolvedAst(name);
    return ast ? formulaToSql(ast, quoteIdent) : quoteIdent(name);
  };
  // Метрика как «значение группы»:
  //  • AGG-calc уже содержит SUM/AVG/… внутри формулы — внешний агрегат не нужен;
  //  • обычный столбец / row-calc оборачиваем в ВЫБРАННУЮ агрегацию (SUM/AVG/MIN/
  //    MAX/COUNT) через metricAggSql, иначе AVG/MIN/MAX считались бы как SUM.
  const metricExpr = (column: string, aggregation: AggregationType): string =>
    calc.isAggCalc(column)
      ? colExpr(column)
      : metricAggSql(aggregation, colExpr(column), null);
  // Для HAVING по threshold-условию метрика всегда суммируется за период.
  const metricSumExpr = (column: string): string =>
    calc.isAggCalc(column) ? colExpr(column) : `sum(${colExpr(column)})`;

  const aggregations = buildAggregations(rule);
  const groupCols = rule.groupBy;
  const selectParts = [
    ...groupCols.map((g) => `${colExpr(g)} AS ${quoteIdent(g)}`),
    ...aggregations.map(
      (v) => `${metricExpr(v.column, v.aggregation)} AS ${quoteIdent(valueKey(v))}`,
    ),
  ];

  // Фильтр по периоду: пытаемся найти столбец date / event_date / event_time.
  // День в виде String ('YYYY-MM-DD') приводим к Date — иначе ClickHouse не
  // находит общий тип для String и DateTime (Code: 386, NO_COMMON_TYPE).
  const dateExpr = dateColumnSqlExpr(dataset, rule.analysis?.dateColumn);
  const range = rule.analysis?.dateRange ?? null;
  const wherePartsRaw: string[] = [];
  if (dateExpr) {
    if (range) {
      wherePartsRaw.push(`${dateExpr} >= toDate('${escapeSql(range.from)}')`);
      wherePartsRaw.push(`${dateExpr} <= toDate('${escapeSql(range.to)}')`);
    } else {
      wherePartsRaw.push(
        `${dateExpr} >= today() - ${Math.max(1, Math.floor(rule.periodDays))}`,
      );
    }
  }
  // Value-фильтры (по значениям полей) — отбор сущностей до агрегации.
  wherePartsRaw.push(
    ...valueFiltersToSqlWhere(rule.analysis?.valueFilters, colExpr, calc.isAggCalc),
  );
  const wherePeriod =
    wherePartsRaw.length > 0 ? ` WHERE ${wherePartsRaw.join(" AND ")}` : "";

  const havingParts: string[] = [];
  for (const c of thresholdConditionsOf(rule.conditions)) {
    const op = sqlOp(c.operator);
    const v = Number(c.value);
    if (!Number.isFinite(v)) continue;
    havingParts.push(`${metricSumExpr(c.metric)} ${op} ${v}`);
  }
  if (typeof rule.minSpendFilter === "number" && rule.minSpendFilter > 0) {
    // Используем sum по любой метрике с именем spend/cost, если она есть.
    const spendCol = findSpendColumn(dataset);
    if (spendCol) {
      havingParts.push(
        `sum(${quoteIdent(spendCol)}) >= ${Number(rule.minSpendFilter)}`,
      );
    }
  }
  const havingClause =
    havingParts.length > 0 ? ` HAVING ${havingParts.join(" AND ")}` : "";

  const groupByClause = groupCols.map((g) => colExpr(g)).join(", ");
  const sql = `SELECT ${selectParts.join(", ")} FROM ${fromClause}${wherePeriod} GROUP BY ${groupByClause}${havingClause} LIMIT 500`;

  const res = await runClickhouseQuery(creds, sql);
  if (!res.ok) {
    throw new Error(friendlyClickhouseError(res.error));
  }
  try {
    const parsed = JSON.parse(res.data) as { data: QueryResultRow[] };
    return parsed.data;
  } catch (e) {
    throw new Error(
      `Не удалось разобрать ответ ClickHouse: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// Расширенные условия (period_change / vs_group_avg / trend)
// ---------------------------------------------------------------------------

function evaluateAdvancedInMemory(
  dataset: Dataset,
  rule: AlertRule,
  allRows: QueryResultRow[],
): { matched: QueryResultRow[]; placeholderColumns: string[] } {
  const calc = prepareDatasetCalc(dataset);
  const rowLevelOrdered = topoSortCalculatedFields(
    calc.prepared.filter((p) => !calc.isAggCalc(p.field.name)),
  );
  const enriched =
    rowLevelOrdered.length > 0
      ? enrichRowsWithCalculated(allRows, rowLevelOrdered)
      : allRows;
  const dateColumn = pickDateColumn(dataset, rule.analysis?.dateColumn);
  const metricAgg = (name: string): DemoMetricFn => {
    if (calc.isAggCalc(name)) {
      const ast = calc.resolvedAst(name);
      return (rows) => (ast ? evaluateAggregateFormula(ast, rows) : null);
    }
    return (rows) => {
      let s = 0;
      for (const r of rows) {
        const n = Number(r[name]);
        if (Number.isFinite(n)) s += n;
      }
      return s;
    };
  };
  // Value-фильтры (по значениям полей) применяем до анализа периодов.
  // Aggregate-calc поля на уровне строки не существуют — пропускаем.
  const vfiltered = applyFilters(
    enriched,
    (rule.analysis?.valueFilters ?? []).filter((f) => !calc.isAggCalc(f.column)),
  );
  return evaluateAdvancedDemo({ rule, allRows: vfiltered, dateColumn, metricAgg });
}

async function evaluateAdvancedClickhouse(
  supabase: SupabaseClient,
  dataset: Dataset,
  rule: AlertRule,
): Promise<{ matched: QueryResultRow[]; placeholderColumns: string[] }> {
  const resolved = await resolveDataSource(supabase, dataset.dataSourceId);
  if (!resolved.ok) throw new Error(resolved.error);
  const creds = resolved.creds;
  const fromClause = dataset.sqlQuery
    ? `(${dataset.sqlQuery.trim().replace(/;$/, "")})`
    : dataset.table
      ? `${quoteIdent(creds.database)}.${quoteIdent(dataset.table)}`
      : null;
  if (!fromClause) throw new Error("В датасете нет таблицы и нет SQL-запроса");

  const calc = prepareDatasetCalc(dataset);
  const colExpr = (name: string): string => {
    const ast = calc.resolvedAst(name);
    return ast ? formulaToSql(ast, quoteIdent) : quoteIdent(name);
  };
  const built = buildAdvancedSql({
    fromClause,
    ruleGroupBy: rule.groupBy,
    // Передаём массив колонок; buildAdvancedSql сам генерит SELECT/GROUP BY.
    colExpr,
    metricRowExpr: (name) =>
      metricRowExprSql(name, {
        isCalc: calc.isCalc,
        isAggCalc: calc.isAggCalc,
        resolvedAst: calc.resolvedAst,
      }),
    dateColumnExpr: dateColumnSqlExpr(dataset, rule.analysis?.dateColumn),
    periodDays: rule.periodDays,
    conditions: rule.conditions,
    minSpendCol:
      typeof rule.minSpendFilter === "number" && rule.minSpendFilter > 0
        ? findSpendColumn(dataset)
        : null,
    minSpendValue:
      typeof rule.minSpendFilter === "number" ? rule.minSpendFilter : null,
    valueFilters: rule.analysis?.valueFilters,
    isAggCalc: calc.isAggCalc,
    displayMetrics: rule.analysis?.metrics,
  });
  if ("error" in built) throw new Error(built.error);
  const res = await runClickhouseQuery(creds, built.sql);
  if (!res.ok) throw new Error(friendlyClickhouseError(res.error));
  try {
    const parsed = JSON.parse(res.data) as { data: QueryResultRow[] };
    return { matched: parsed.data, placeholderColumns: built.placeholderColumns };
  } catch (e) {
    throw new Error(
      `Не удалось разобрать ответ ClickHouse: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

function pickDateColumn(
  dataset: Dataset,
  preferred?: string | null,
): string | null {
  // Явно выбранный пользователем столбец даты (если он есть в датасете).
  if (preferred) {
    const found = dataset.columns.find((c) => c.name === preferred);
    if (found) return found.name;
  }
  const lowered = dataset.columns.map((c) => c.name.toLowerCase());
  for (const c of ["day", "date", "event_date", "event_time", "ds", "ts", "created_at", "report_date"]) {
    const i = lowered.indexOf(c);
    if (i !== -1) return dataset.columns[i].name;
  }
  return null;
}

/**
 * Если результат пуст ИЗ-ЗА периода (все строки источника вне выбранного окна
 * дат) — формируем понятную подсказку с реальным диапазоном данных. Возвращает
 * null, если период не виноват (строки в окне есть) или нет колонки даты/данных.
 * Особенно актуально для файловых источников (статичный экспорт за прошлые даты).
 */
function emptyPeriodHint(
  dataset: Dataset,
  rule: AlertRule,
  allRows: QueryResultRow[] | null,
): string | null {
  if (!allRows || allRows.length === 0) return null;
  const dateCol = pickDateColumn(dataset, rule.analysis?.dateColumn);
  if (!dateCol) return null;
  const range = rule.analysis?.dateRange ?? null;
  const since = new Date();
  since.setDate(since.getDate() - rule.periodDays);
  const sinceStr = since.toISOString().slice(0, 10);
  let inPeriod = 0;
  let min: string | null = null;
  let max: string | null = null;
  for (const r of allRows) {
    const d = r[dateCol];
    if (typeof d !== "string") {
      inPeriod++; // нестроковые даты фильтр пропускает — строка остаётся
      continue;
    }
    const day = d.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      if (!min || day < min) min = day;
      if (!max || day > max) max = day;
    }
    const pass = range ? day >= range.from && day <= range.to : day >= sinceStr;
    if (pass) inPeriod++;
  }
  if (inPeriod > 0) return null; // период не виноват — строки в окне есть
  if (!min || !max) return null;
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y}`;
  };
  const periodDesc = range
    ? `диапазон ${fmt(range.from)} – ${fmt(range.to)}`
    : `последние ${rule.periodDays} дн.`;
  return `Нет строк за выбранный период (${periodDesc}). В источнике есть данные за ${fmt(min)} – ${fmt(max)} (колонка «${dateCol}»). Увеличьте период или задайте диапазон дат на шаге «Датасет и период».`;
}

/**
 * SQL-выражение столбца-даты, гарантированно сравнимое с `today()` / `now()`.
 * ClickHouse не находит общий тип для String и DateTime (Code: 386,
 * NO_COMMON_TYPE), поэтому строковый столбец (формат YYYY-MM-DD) оборачиваем
 * в `toDate(...)`; Date / Date32 / DateTime(64) оставляем как есть.
 */
function dateColumnSqlExpr(
  dataset: Dataset,
  preferred?: string | null,
): string | null {
  const name = pickDateColumn(dataset, preferred);
  if (!name) return null;
  const ident = quoteIdent(name);
  const col = dataset.columns.find((c) => c.name === name);
  const base = (col?.clickhouseType ?? "")
    .trim()
    .replace(/^Nullable\(/i, "")
    .replace(/^LowCardinality\(/i, "");
  if (/^Date(32)?\b/i.test(base) || /^DateTime/i.test(base)) return ident;
  return `toDate(${ident})`;
}

function findSpendColumn(dataset: Dataset): string | null {
  for (const c of dataset.columns) {
    const n = c.name.toLowerCase();
    if (n === "spend" || n === "cost") return c.name;
  }
  return null;
}

function sqlOp(op: AlertConditionOperator): string {
  return op === "=" ? "=" : op;
}

function filterMatched(
  rows: QueryResultRow[],
  rule: AlertRule,
): QueryResultRow[] {
  // Если данные были сагрегированы in-memory (демо), значения метрик
  // лежат под ключом `SUM(metric)`. После CH — то же имя, потому что
  // мы используем `valueKey` как алиас.
  return rows.filter((row) => {
    for (const c of thresholdConditionsOf(rule.conditions)) {
      const key = `SUM(${c.metric})`;
      const raw = row[key] ?? row[c.metric];
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return false;
      if (!compare(n, c.operator, c.value)) return false;
    }
    if (
      typeof rule.minSpendFilter === "number" &&
      rule.minSpendFilter > 0
    ) {
      const sCol = ["SUM(spend)", "SUM(cost)", "spend", "cost"];
      let s: number | null = null;
      for (const k of sCol) {
        const r = row[k];
        if (typeof r === "number") {
          s = r;
          break;
        }
        const n = Number(r);
        if (!Number.isNaN(n)) {
          s = n;
          break;
        }
      }
      if (s !== null && s < rule.minSpendFilter) return false;
    }
    return true;
  });
}

function compare(
  a: number,
  op: AlertConditionOperator,
  b: number,
): boolean {
  switch (op) {
    case "<":
      return a < b;
    case ">":
      return a > b;
    case "<=":
      return a <= b;
    case ">=":
      return a >= b;
    case "=":
      return a === b;
  }
}

// ---------------------------------------------------------------------------
// Сводная таблица ({table}) + сортировка / топ-N (конструктор анализа)
// ---------------------------------------------------------------------------

/**
 * Сравнение двух значений ячейки: числа — по величине, иначе — лексикографически
 * (ru). Пустые/`—`/null уходят вниз независимо от направления.
 */
function compareCellValues(av: unknown, bv: unknown, dir: 1 | -1): number {
  const aEmpty = av === null || av === undefined || av === "";
  const bEmpty = bv === null || bv === undefined || bv === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1; // пустые всегда внизу
  if (bEmpty) return -1;
  const an = typeof av === "number" ? av : Number(av);
  const bn = typeof bv === "number" ? bv : Number(bv);
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir;
  return String(av).localeCompare(String(bv), "ru") * dir;
}

/**
 * Сортирует строки и обрезает до `analysis.topN`.
 * Если задана явная сортировка (`analysis.sort`) — по ней. Иначе по умолчанию —
 * по колонкам группировки слева направо (channel → code → GEO), чтобы одинаковые
 * значения шли подряд (все TikTok вместе и т.д.).
 */
function applySortAndLimit(
  rows: QueryResultRow[],
  rule: AlertRule,
): QueryResultRow[] {
  const sort = rule.analysis?.sort ?? null;
  let out = rows;
  if (sort && sort.column) {
    const key = sort.column;
    const dir = sort.direction === "asc" ? 1 : -1;
    out = rows.slice().sort((a, b) => compareCellValues(a[key], b[key], dir));
  } else if (rule.groupBy.length > 0) {
    // Дефолт: стабильная сортировка по группировке слева направо (asc).
    const cols = rule.groupBy;
    out = rows.slice().sort((a, b) => {
      for (const g of cols) {
        const c = compareCellValues(a[g], b[g], 1);
        if (c !== 0) return c;
      }
      return 0;
    });
  }
  const topN = rule.analysis?.topN ?? null;
  if (typeof topN === "number" && topN > 0) out = out.slice(0, topN);
  return out;
}

interface TableColumn {
  key: string;
  label: string;
  isDim: boolean;
  format?: CalculatedFieldFormat;
}

/** Метрики из условий (SUM каждой), дедуп — фоллбэк, если метрики не заданы. */
function dedupeConditionMetrics(rule: AlertRule): PivotValueConfig[] {
  const seen = new Set<string>();
  const out: PivotValueConfig[] = [];
  for (const c of rule.conditions) {
    if (seen.has(c.metric)) continue;
    seen.add(c.metric);
    out.push({ column: c.metric, aggregation: "SUM" });
  }
  return out;
}

/** Колонки таблицы: группировки (dim) + метрики (с форматом calc-полей). */
function tableColumnsFor(rule: AlertRule, dataset: Dataset): TableColumn[] {
  const cols: TableColumn[] = [];
  for (const g of rule.groupBy) cols.push({ key: g, label: g, isDim: true });

  const metrics: PivotValueConfig[] =
    rule.analysis?.metrics && rule.analysis.metrics.length > 0
      ? rule.analysis.metrics
      : dedupeConditionMetrics(rule);

  const fmtByName = new Map<string, CalculatedFieldFormat | undefined>(
    (dataset.calculatedFields ?? []).map((f) => [f.name, f.format]),
  );
  for (const m of metrics) {
    cols.push({
      key: valueKey(m),
      label:
        m.aggregation === "SUM" ? m.column : `${m.column} (${m.aggregation})`,
      isDim: false,
      format: fmtByName.get(m.column),
    });
  }
  return cols;
}

const TABLE_MAX_ROWS = 100;
/** Максимальная ширина одной колонки (символов) — длиннее → обрезаем «…». */
const TABLE_COL_MAX = 16;
/** Порог суммарной ширины: шире → в Telegram на телефоне строки переносятся. */
const TABLE_WIDTH_WARN = 34;

/** Текст ячейки: dim — строка как есть, метрика — форматированное число / «—». */
function cellText(col: TableColumn, row: QueryResultRow): string {
  const raw = row[col.key];
  if (col.isDim) {
    return raw === null || raw === undefined || raw === "" ? "—" : String(raw);
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (raw === null || raw === undefined || raw === "" || Number.isNaN(n)) {
    return "—";
  }
  return formatCalculatedValue(n, col.format);
}

/** Обрезает слишком длинное значение многоточием до `max` символов. */
function truncateCell(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return "…";
  return s.slice(0, max - 1) + "…";
}

/**
 * Структурированная сводная таблица: колонки + строки готовых строковых ячеек
 * (с усечением), для рендера и в текст (Telegram), и в интерактивный UI-превью.
 */
export interface PivotTableData {
  columns: { key: string; label: string; isDim: boolean }[];
  /** Готовые строковые ячейки (уже усечённые до TABLE_COL_MAX). */
  rows: string[][];
  /** Сколько строк всего (до обрезки до TABLE_MAX_ROWS). */
  totalRows: number;
  /** Сумма ширин колонок (символы) — для предупреждения о ширине. */
  totalWidth: number;
  /** true — таблица шире безопасного порога для Telegram-телефона. */
  tooWide: boolean;
}

function buildTableData(
  rows: QueryResultRow[],
  rule: AlertRule,
  dataset: Dataset,
): PivotTableData | null {
  const cols = tableColumnsFor(rule, dataset);
  if (cols.length === 0 || rows.length === 0) return null;
  const limited = rows.slice(0, TABLE_MAX_ROWS);

  const body = limited.map((r) =>
    cols.map((c) => truncateCell(cellText(c, r), TABLE_COL_MAX)),
  );
  const header = cols.map((c) => truncateCell(c.label, TABLE_COL_MAX));
  const widths = cols.map((_, i) =>
    Math.max(header[i].length, ...body.map((r) => r[i].length)),
  );
  const totalWidth =
    widths.reduce((s, w) => s + w, 0) + (cols.length - 1) * 2; // «  » между колонками

  return {
    columns: cols.map((c) => ({ key: c.key, label: c.label, isDim: c.isDim })),
    rows: body,
    totalRows: rows.length,
    totalWidth,
    tooWide: totalWidth > TABLE_WIDTH_WARN,
  };
}

/** Рендерит выровненную моноширинную таблицу (без code-fence) из PivotTableData. */
function renderTableDataText(data: PivotTableData): string {
  const { columns, rows } = data;
  const header = columns.map((c) => truncateCell(c.label, TABLE_COL_MAX));
  const widths = columns.map((_, i) =>
    Math.max(header[i].length, ...rows.map((r) => r[i].length), 1),
  );
  // Числа выравниваем по правому краю, текст (dim) — по левому.
  const pad = (s: string, w: number, left: boolean) =>
    left ? s.padEnd(w) : s.padStart(w);
  const fmtRow = (cells: string[]) =>
    cells.map((c, i) => pad(c, widths[i], columns[i].isDim)).join("  ");
  const sep = widths.map((w) => "─".repeat(w)).join("  ");
  const lines = [fmtRow(header), sep, ...rows.map(fmtRow)];
  if (data.totalRows > rows.length) {
    lines.push(`… ещё ${data.totalRows - rows.length}`);
  }
  return lines.join("\n");
}

/** Рендерит выровненную моноширинную таблицу (без code-fence). */
function renderPivotTableText(
  rows: QueryResultRow[],
  rule: AlertRule,
  dataset: Dataset,
): string {
  const data = buildTableData(rows, rule, dataset);
  if (!data) return "";
  return renderTableDataText(data);
}

/** Оборачивает таблицу в code-block под parse_mode (для none — plain). */
function wrapTableForParseMode(
  plain: string,
  parseMode: TelegramParseMode,
): string {
  if (!plain) return "—";
  if (parseMode === "html") return `<pre>${escapeHtmlPlain(plain)}</pre>`;
  if (parseMode === "markdown" || parseMode === "markdownv2") {
    const esc = plain.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
    return "```\n" + esc + "\n```";
  }
  return plain;
}

// ---------------------------------------------------------------------------
// Переменные шаблона
// ---------------------------------------------------------------------------

interface VarInput {
  rule: AlertRule;
  dataset: Dataset;
  /** Строки для отображения (уже отсортированы и обрезаны до топ-N). */
  matched: QueryResultRow[];
  /** Полное число матчей (до топ-N) — для {matches_count}. */
  totalCount: number;
  /** Динамические плейсхолдеры из расширенных условий (cpa_3d, deviation_percent, …). */
  placeholderColumns?: string[];
  userEmail: string;
  parseMode: TelegramParseMode;
  /** Готовая моноширинная таблица (без code-fence) для {table}. */
  tablePlain: string;
}

function buildVariables(input: VarInput): Record<string, string> {
  const { rule, dataset, matched, userEmail, parseMode } = input;
  const escape: (v: string) => string =
    parseMode === "markdownv2"
      ? escapeMarkdownV2
      : parseMode === "markdown"
        ? escapeMarkdownClassic
        : parseMode === "html"
          ? escapeHtmlPlain
          : (v) => v;

  const periodLabel = `${rule.periodDays} ${pluralDays(rule.periodDays)}`;
  const nowIso = new Date().toISOString();

  // top_objects: первые 5 матчей в формате "groupCol1=v1 | groupCol2=v2: metric=value, ...".
  const groupCols = rule.groupBy;
  const top = matched
    .slice(0, 5)
    .map((row) => {
      const idParts =
        groupCols.length === 1
          ? [String(row[groupCols[0]] ?? "—")]
          : groupCols.map((g) => `${g}=${row[g] ?? "—"}`);
      const id = idParts.join(" | ");
      const metrics = rule.conditions
        .map((c) => {
          const key = `SUM(${c.metric})`;
          const v = row[key] ?? row[c.metric];
          const n = typeof v === "number" ? v : Number(v);
          const formatted = Number.isFinite(n)
            ? formatNumber(n)
            : String(v ?? "");
          return `${c.metric}=${formatted}`;
        })
        .join(", ");
      return `• ${id}: ${metrics}`;
    })
    .join("\n");

  // Динамические плейсхолдеры из расширенных условий ({cpa_3d}, {deviation_percent}, …).
  // Имена собираем из условий правила, значения — из первой матч-строки.
  const dynColNames = new Set<string>(input.placeholderColumns ?? []);
  for (const c of rule.conditions) {
    for (const n of placeholderNamesFor(c)) dynColNames.add(n);
  }
  const firstRow = matched[0] ?? {};
  // Простые-именованные колонки матч-строки (code, channel, GEO, cost, …)
  // тоже доступны как плейсхолдеры — но не перетирают фиксированные.
  const fixedNames = new Set([
    "user_email", "dataset_name", "period_label", "now", "matches_count",
    "table", "top_objects", "ai_recommendation", "tag_users", "rule_name", "creative_name",
  ]);
  for (const k of Object.keys(firstRow)) {
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) && !fixedNames.has(k)) dynColNames.add(k);
  }
  const dyn: Record<string, string> = {};
  for (const name of dynColNames) {
    const v = firstRow[name];
    const formatted =
      v === null || v === undefined
        ? "—"
        : typeof v === "number"
          ? Number.isInteger(v)
            ? String(v)
            : v.toFixed(2)
          : String(v);
    dyn[name] = escape(formatted);
  }

  return {
    ...dyn,
    user_email: escape(userEmail),
    dataset_name: escape(dataset.name),
    period_label: escape(periodLabel),
    now: escape(nowIso),
    matches_count: String(input.totalCount),
    top_objects: escape(top || "—"),
    // {table} — готовый code-block (НЕ экранируем как обычное значение).
    table: wrapTableForParseMode(input.tablePlain, parseMode),
    // AI-рекомендации удалены: legacy-шаблоны с {ai_recommendation} рендерятся как «—».
    ai_recommendation: "—",
    tag_users: escape((rule.tagUsers ?? "").trim()),
    rule_name: escape(rule.name),
    creative_name: escape(
      String(
        groupCols.length === 1
          ? matched[0]?.[groupCols[0]] ?? "—"
          : groupCols.map((g) => matched[0]?.[g] ?? "—").join(" | "),
      ),
    ),
  };
}

function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20))
    return "дня";
  return "дней";
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(2);
  return n.toFixed(3);
}

// ---------------------------------------------------------------------------
// Telegram API
// ---------------------------------------------------------------------------

const TG_MSG_CHAR_SOFT_MAX = 4000;
/** Верхний предел суммарной длины для поочерёдных sendMessage перед sendDocument */
const TG_CHUNKED_TOTAL_MAX = 12000;

interface TgSendInput {
  token: string;
  chatId: string;
  text: string;
  parseMode: TelegramParseMode;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Параметр `parse_mode` для Bot API или `undefined` (без разметки). */
function telegramApiParseMode(
  mode: TelegramParseMode,
): "Markdown" | "MarkdownV2" | "HTML" | undefined {
  switch (mode) {
    case "none":
      return undefined;
    case "markdown":
      return "Markdown";
    case "markdownv2":
      return "MarkdownV2";
    case "html":
      return "HTML";
  }
}

function isEntityParseError(description: string | undefined): boolean {
  const d = (description ?? "").toLowerCase();
  return (
    d.includes("can't parse entities") || d.includes("can't parse entity")
  );
}

async function telegramSendMessageJson(payload: {
  token: string;
  chatId: string;
  text: string;
  parseModeApi?: "Markdown" | "MarkdownV2" | "HTML";
}): Promise<
  { ok: true } | { ok: false; error: string; description?: string }
> {
  const url = `https://api.telegram.org/bot${payload.token}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: payload.chatId,
    text: payload.text,
  };
  if (payload.parseModeApi) body.parse_mode = payload.parseModeApi;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
    };
    if (!res.ok || json.ok !== true) {
      return {
        ok: false,
        error: json.description ?? `Telegram вернул HTTP ${res.status}`,
        description: json.description,
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function telegramSendJsonWithRetry(
  token: string,
  chatId: string,
  text: string,
  preferredApiParseMode: "Markdown" | "MarkdownV2" | "HTML" | undefined,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let mode: "Markdown" | "MarkdownV2" | "HTML" | undefined = preferredApiParseMode;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await telegramSendMessageJson({
      token,
      chatId,
      text,
      parseModeApi: mode,
    });
    if (res.ok) return res;
    if (
      attempt === 0 &&
      mode !== undefined &&
      isEntityParseError(res.description ?? res.error)
    ) {
      mode = undefined;
      continue;
    }
    return { ok: false, error: res.error };
  }
  return { ok: false, error: "Не удалось отправить в Telegram после повтора" };
}

function splitTextIntoTelegramChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    const slice = remaining.slice(0, maxLen);
    const minPos = Math.max(180, Math.floor(maxLen * 0.42));
    let cut = maxLen;
    let pos = slice.lastIndexOf("\n\n");
    if (pos >= minPos) cut = pos + 2;
    else {
      pos = slice.lastIndexOf("\n");
      if (pos >= minPos) cut = pos + 1;
      else {
        pos = slice.lastIndexOf(". ");
        if (pos >= minPos) cut = pos + 2;
        else {
          pos = slice.lastIndexOf(" ");
          if (pos >= minPos) cut = pos + 1;
        }
      }
    }
    cut = Math.max(1, Math.min(cut, remaining.length));
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

async function telegramSendDocument(
  token: string,
  chatId: string,
  filename: string,
  fullText: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  try {
    const form = new FormData();
    form.set("chat_id", chatId);
    const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
    form.set("document", blob, filename);

    const res = await fetch(url, { method: "POST", body: form });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
    };
    if (!res.ok || json.ok !== true) {
      return {
        ok: false,
        error: json.description ?? `Telegram sendDocument HTTP ${res.status}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function previewForLongTelegramAlert(fullText: string): string {
  const HEAD = 900;
  const intro = fullText.slice(0, HEAD);
  const br = intro.lastIndexOf("\n\n");
  const headSlice = br >= 200 ? intro.slice(0, br) : intro;
  let header = `${headSlice.trimEnd()}\n\n━━━━━━━━━━━━\n… (${fullText.length} символов)\n📎 Полный текст — во вложении (alert-detail.txt)`;
  if (header.length > TG_MSG_CHAR_SOFT_MAX - 120) {
    header = `${fullText.slice(0, TG_MSG_CHAR_SOFT_MAX - 180).trimEnd()}…`;
    header +=
      `\n\n━━━━━━━━━━━━\n… (${fullText.length} символов)\n📎 Полное сообщение во вложении (alert-detail.txt)`;
  }
  if (header.length > TG_MSG_CHAR_SOFT_MAX) {
    header = header.slice(0, TG_MSG_CHAR_SOFT_MAX - 4) + "…";
  }
  return header;
}

/**
 * Если сообщение = «вступление + один code-block» (<pre>…</pre> или ```…```),
 * разбивает его на части так, чтобы КАЖДАЯ часть была самостоятельным валидным
 * code-block'ом. Иначе (нет code-block) — null, чтобы упасть в обычный сплит.
 * Это чинит «косую» таблицу: при наивном сплите первый кусок получал `<pre>`
 * без закрывающего тега → Telegram отклонял HTML и слал plain-текст.
 */
function splitCodeBlockMessage(
  text: string,
  parseMode: TelegramParseMode,
  maxLen: number,
): string[] | null {
  let open: string;
  let close: string;
  if (parseMode === "html") {
    open = "<pre>";
    close = "</pre>";
  } else if (parseMode === "markdown" || parseMode === "markdownv2") {
    open = "```\n";
    close = "\n```";
  } else {
    return null; // без разметки делить нечем — обычный сплит
  }

  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start === -1 || end === -1 || end <= start) return null;

  const prefix = text.slice(0, start); // вступление (📊 Отчёт за …\n\n)
  const inner = text.slice(start + open.length, end); // содержимое таблицы
  const lines = inner.split("\n");

  // Бюджет на содержимое = maxLen − длина обёрток − длина префикса (на 1-й кусок).
  const wrapLen = open.length + close.length;
  const out: string[] = [];
  let buf: string[] = [];
  let isFirst = true;

  const flush = () => {
    const body = buf.join("\n");
    const pre = isFirst ? prefix : "";
    out.push(`${pre}${open}${body}${close}`);
    buf = [];
    isFirst = false;
  };

  for (const line of lines) {
    const budget = maxLen - wrapLen - (isFirst ? prefix.length : 0);
    const projected = (buf.length > 0 ? buf.join("\n").length + 1 : 0) + line.length;
    if (buf.length > 0 && projected > budget) {
      flush();
    }
    // одиночная строка длиннее бюджета — кладём как есть (редко; Telegram сам перенесёт)
    buf.push(line);
  }
  if (buf.length > 0 || out.length === 0) flush();
  return out;
}

export async function sendTelegramMessage(
  input: TgSendInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { token, chatId, text } = input;
  const apiMode = telegramApiParseMode(input.parseMode);

  if (text.length <= TG_MSG_CHAR_SOFT_MAX) {
    return telegramSendJsonWithRetry(token, chatId, text, apiMode);
  }

  // Code-block-aware сплит: каждую часть оборачиваем в свой <pre>/``` ,
  // чтобы таблица оставалась моноширинной во всех сообщениях.
  if (text.length <= TG_CHUNKED_TOTAL_MAX) {
    const cbChunks = splitCodeBlockMessage(
      text,
      input.parseMode,
      TG_MSG_CHAR_SOFT_MAX,
    );
    const chunks = cbChunks ?? splitTextIntoTelegramChunks(text, TG_MSG_CHAR_SOFT_MAX);
    for (let i = 0; i < chunks.length; i++) {
      const r = await telegramSendJsonWithRetry(
        token,
        chatId,
        chunks[i],
        apiMode,
      );
      if (!r.ok) return r;
      if (i < chunks.length - 1) await sleep(100);
    }
    return { ok: true };
  }

  const header = previewForLongTelegramAlert(text);
  const headRes = await telegramSendJsonWithRetry(
    token,
    chatId,
    header,
    apiMode,
  );
  if (!headRes.ok) return headRes;

  await sleep(100);

  const docRes = await telegramSendDocument(token, chatId, "alert-detail.txt", text);
  if (!docRes.ok) return docRes;

  return { ok: true };
}

interface TgMeResult {
  ok: boolean;
  username?: string;
  description?: string;
}

export async function telegramGetMe(token: string): Promise<TgMeResult> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { username?: string };
      description?: string;
    };
    if (!res.ok || !json.ok || !json.result) {
      return { ok: false, description: json.description ?? `HTTP ${res.status}` };
    }
    return { ok: true, username: json.result.username };
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : String(e) };
  }
}

interface TgChatResult {
  ok: boolean;
  title?: string;
  description?: string;
}

export async function telegramGetChat(
  token: string,
  chatId: string,
): Promise<TgChatResult> {
  try {
    const url = `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(
      chatId,
    )}`;
    const res = await fetch(url);
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: {
        title?: string;
        username?: string;
        first_name?: string;
        last_name?: string;
      };
      description?: string;
    };
    if (!res.ok || !json.ok || !json.result) {
      return { ok: false, description: json.description ?? `HTTP ${res.status}` };
    }
    const r = json.result;
    const title =
      r.title ??
      (r.username ? `@${r.username}` : null) ??
      [r.first_name, r.last_name].filter(Boolean).join(" ") ??
      chatId;
    return { ok: true, title };
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : String(e) };
  }
}

// re-export для использования в API-роутах без прямого импорта sql-validator
export { escapeSql };
