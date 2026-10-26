export type DatasetColumnType =
  | "integer"
  | "float"
  | "string"
  | "date"
  | "datetime"
  | "boolean"
  | "category";

export type AggregationType = "SUM" | "AVG" | "COUNT" | "MIN" | "MAX";

export type DataSourceKind = "clickhouse" | "file";

export interface DataSource {
  id: string;
  name: string;
  /** Свободное описание источника «для чего он». Опционально. */
  description?: string;
  host: string;
  port: number;
  database: string;
  user: string;
  /** base64-encoded for MVP */
  password: string;
  ssl: boolean;
  status: "connected" | "error" | "unknown";
  statusMessage?: string;
  createdAt: string;
  tables?: string[];
  /** marks demo source (no real credentials) */
  isDemo?: boolean;
  /**
   * Тип источника: ClickHouse (по умолчанию) или файловый (CSV/Excel/Google
   * Sheets — данные хранятся в Supabase, движок считает in-JS, как демо).
   */
  kind?: DataSourceKind;
  /** Для файловых источников: формат ('csv' | 'excel' | 'gsheet'). */
  fileFormat?: string;
  /** Для Google Sheets: режим данных ('snapshot' | 'live'). */
  fileMode?: "snapshot" | "live";
  /** Для снимка Google Sheets: когда последний раз обновляли из таблицы. */
  lastRefreshedAt?: string | null;
}

export interface TableInfo {
  name: string;
  engine?: string;
  totalRows?: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface DatasetColumn {
  name: string;
  clickhouseType: string;
  datasetType: DatasetColumnType;
  /** Технический смысл — что физически содержит столбец. */
  description: string;
  /**
   * Бизнес-контекст столбца: как байер интерпретирует значения, что
   * считается аномалией, какие пороги критичны. Используется для
   * AI-генерации alert-правил. Старые записи в БД нормализуются в "".
   */
  businessContext: string;
  enabled: boolean;
  /** Дублирует `businessContext` при сохранении из UI для совместимости. */
  aiDescription?: string;
  /**
   * true — `datasetType` совпадает с автомаппингом из `clickhouseType`
   * (не переопределялся вручную). false — пользователь сменил тип
   * вручную, авто-сброс не применяется. Если поле отсутствует
   * (старые записи) — нормализуется при чтении из БД.
   */
  isAutoDetected?: boolean;
}

/**
 * Формат отображения вычисляемого поля в таблицах/графиках. Используется
 * только клиентским рендером (`lib/format-value.ts`), на бэк не уходит.
 */
export const CALCULATED_FIELD_FORMATS = [
  "number",
  "integer",
  "currency_usd",
  "currency_rub",
  "percent",
] as const;

export type CalculatedFieldFormat = (typeof CALCULATED_FIELD_FORMATS)[number];

export interface CalculatedField {
  id: string;
  name: string;
  /**
   * Формула в нотации с квадратными скобками: `[revenue] / [installs] * 100`.
   * Также поддерживается legacy bare-identifier-нотация
   * (`revenue / installs * 100`) — для совместимости с полями, созданными
   * до сессии 27. Парсер `lib/formula.ts` принимает оба варианта.
   */
  formula: string;
  datasetType: "float" | "integer";
  /** Формат отображения. Если не задан — `number`. */
  format?: CalculatedFieldFormat;
  /** Свободное описание поля «для байера» (помогает вспомнить логику). */
  description?: string;
  /** Описание вычисляемого поля для AI. */
  aiDescription?: string;
}

export interface FunnelStep {
  column: string;
  label: string;
  order: number;
}

export type KpiCampaignStage =
  | "test"
  | "scale"
  | "optimization"
  | "maintenance";

export type KpiThresholdOperator = "<" | ">" | "<=" | ">=";

export interface KpiCriticalThreshold {
  metric: string;
  operator: KpiThresholdOperator;
  value: number;
  label: string;
}

/**
 * KPI-профиль клиента/кампании. Используется AI-генерацией alert-правил
 * как источник «нормы» и критичных порогов. Все поля опциональны;
 * минимально-валидным считается профиль с заполненными `targetMetric`
 * и `targetValue`.
 */
export interface KpiProfile {
  /** Название целевой метрики (имя столбца датасета или произвольная строка). */
  targetMetric?: string;
  /** Целевое значение метрики. */
  targetValue?: number;
  /** На какой день оцениваем целевую метрику (например, ROAS на D7). */
  targetPeriodDays?: number;
  /** Дневной бюджет в долларах. */
  dailyBudgetUsd?: number;
  /** Стадия кампании. */
  stage?: KpiCampaignStage;
  /** Критичные пороги для alert-правил. */
  criticalThresholds?: KpiCriticalThreshold[];
  /** Свободные заметки байера. */
  notes?: string;
}

export interface Dataset {
  id: string;
  name: string;
  dataSourceId: string;
  table: string | null;
  sqlQuery: string | null;
  columns: DatasetColumn[];
  createdAt: string;
  rowCount?: number;
  calculatedFields: CalculatedField[];
  /**
   * Общее описание бизнеса / продукта / KPI для AI-анализа и генерации
   * alert-правил. После миграции колонка в БД NOT NULL DEFAULT ''.
   * В старых записях без поля нормализуется в "".
   */
  businessContext: string;
  /**
   * KPI-профиль клиента: целевые метрики, бюджет, критичные пороги.
   * После миграции колонка в БД NOT NULL DEFAULT '{}'.
   * В старых записях без поля нормализуется в `{}`.
   */
  kpiProfile: KpiProfile;
  /** Этапы воронки конверсий: какие меры в каком порядке образуют воронку. */
  funnelSteps?: FunnelStep[];
}

export type VisualizationType =
  | "pivot"
  | "bar"
  | "line"
  | "pie"
  | "area"
  /** Комбо: `xAxis` — измерение, `values[0]` — столбцы, `values[1..]` — линии. */
  | "combo"
  /** Прогресс: `rows[0]` (необязательно) — разрез, `values` — поля `· выполнение %`. */
  | "progress";

export interface FilterCondition {
  id: string;
  column: string;
  operator: "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "in";
  /** For operator "in", value is a JSON-encoded string array (e.g. '["US","EU"]'). */
  value: string;
}

export interface PivotValueConfig {
  column: string;
  aggregation: AggregationType;
}

export interface VisualizationConfig {
  rows: string[];
  columns: string[];
  values: PivotValueConfig[];
  xAxis?: string;
  yAxis?: PivotValueConfig;
  series?: string | null;
  filters: FilterCondition[];
  /**
   * Формат значения по имени колонки меры (₽/$/%/число) — задаётся у значения
   * в конструкторе. Нет ключа — формат вычисляемого поля/поля плана, иначе
   * угадывается по суффиксу `_rub` → ₽, `_usd` → $ (`resolveValueFormat`).
   */
  valueFormats?: Record<string, CalculatedFieldFormat>;
  /**
   * План-проект, из которого собран график (шаблон «Собрать дашборд»).
   * Есть — план берётся по нему; нет (старые графики) — по датасету.
   */
  planProjectId?: string;
}

export interface Visualization {
  id: string;
  name: string;
  datasetId: string;
  type: VisualizationType;
  config: VisualizationConfig;
  /**
   * Вычисляемые поля, живущие ТОЛЬКО в этой визуализации.
   * Применяются поверх `dataset.calculatedFields` (сначала эвалятся
   * полные dataset-поля, затем — visualization-поля; visualization-поля
   * могут ссылаться на dataset-поля и наоборот не могут). Сессия 27.
   */
  calculatedFields?: CalculatedField[];
  createdAt: string;
}

// Известные модели как подсказки + любой string (мультипровайдерность: Claude,
// GPT, Gemini; новые модели можно хранить, не меняя тип).
export type AIModelId =
  | "haiku"
  | "sonnet"
  | "opus"
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gemini-2.0-flash"
  | "gemini-1.5-pro"
  | (string & {});

/** LLM-провайдеры (прямые интеграции, BYOK). */
export type AIProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "groq"
  | "cerebras"
  | "mistral";

export interface AIAnalysis {
  id: string;
  dataType: "dataset" | "visualization";
  dataId: string;
  prompt: string;
  response: string;
  cost: number;
  createdAt: string;
  /** Которую модель Claude использовали для этого запроса. */
  model?: AIModelId;
}

export interface AppSettings {
  theme: "dark" | "light";
  /**
   * Маркеры «configured»/"" по каждому провайдеру (сам ключ на клиент не
   * возвращается). Добавление провайдера не требует менять этот тип.
   */
  providerKeys: Record<AIProvider, string>;
}

export interface QueryRequestConfig {
  dataSourceId: string;
  datasetId: string;
  rows?: string[];
  columns?: string[];
  values?: PivotValueConfig[];
  xAxis?: string;
  yAxis?: PivotValueConfig;
  series?: string | null;
  filters?: FilterCondition[];
  limit?: number;
}

export interface QueryResultRow {
  [key: string]: string | number | null;
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

export type DashboardFilterType =
  | "select"
  | "multi_select"
  | "date_range"
  | "number_range";

export interface DashboardFilter {
  id: string;
  column: string;
  label: string;
  type: DashboardFilterType;
  defaultValue?: unknown;
}

export type DashboardWidgetType = "chart" | "pivot" | "metric" | "text";

export type DashboardWidgetWidth = "full" | "half" | "third";

export interface MetricWidgetConfig {
  column: string;
  aggregation: AggregationType;
  /**
   * `auto` (и отсутствие) — как у поля: формат вычисляемого поля / поля плана
   * или по суффиксу `_rub`/`_usd`. `currency` — старое значение, это $.
   */
  format?: "auto" | "number" | "currency" | "percent" | CalculatedFieldFormat;
  /** План-проект виджета (шаблон «Собрать дашборд»); нет — план по датасету. */
  planProjectId?: string;
}

export interface TextWidgetConfig {
  text: string;
}

export interface DashboardWidget {
  id: string;
  sheetId: string;
  visualizationId?: string;
  widgetType: DashboardWidgetType;
  title: string;
  /** For metric: MetricWidgetConfig. For text: TextWidgetConfig. For chart/pivot: {} (viz drives rendering). */
  config: Record<string, unknown>;
  sortOrder: number;
  width: DashboardWidgetWidth;
}

export interface DashboardSheet {
  id: string;
  dashboardId: string;
  name: string;
  sortOrder: number;
  widgets: DashboardWidget[];
}

export interface Dashboard {
  id: string;
  userId: string;
  datasetId: string;
  name: string;
  description?: string;
  filtersConfig: DashboardFilter[];
  sheets: DashboardSheet[];
  /** Число листов из списка дашбордов (там `sheets` не грузятся — только счётчик). */
  sheetsCount?: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// AI Projects
// ---------------------------------------------------------------------------

export type AIBuilderFocus =
  | "problems"
  | "trends"
  | "segments"
  | "optimization"
  | "report";

export interface AIBuilderConfig {
  /** Какие показатели/столбцы включить в анализ. */
  columns: string[];
  /** По какому столбцу группировать. */
  groupBy?: string;
  /** Период (если не задан в фильтрах). */
  period?: { from?: string; to?: string };
  /** Фокусы анализа (мульти-чекбокс). */
  focus: AIBuilderFocus[];
  /** Дополнительный контекст. */
  additionalContext?: string;
  /**
   * Многоуровневая группировка для запроса данных в AI: в Claude уходит сводная
   * таблица по этим измерениям (а не сырые строки). Пусто = сырые строки.
   */
  analysisGroupBy?: string[];
  /**
   * Метрики с агрегацией для сводной таблицы. Пусто (при заданной группировке) =
   * суммируются все числовые столбцы.
   */
  analysisMetrics?: PivotValueConfig[];
  /**
   * Фильтры по значениям измерений: `имя_столбца → выбранные значения`. Пустой
   * массив/отсутствие = брать все значения. Применяются до агрегации.
   */
  analysisValueFilters?: Record<string, string[]>;
}

export interface AIProject {
  id: string;
  userId: string;
  name: string;
  description?: string;
  datasetId: string;
  model: AIModelId;
  /** Сконфигурированные фильтры данных (meta). */
  filtersConfig: DashboardFilter[];
  /** Активные значения фильтров. */
  filterValues: Record<string, unknown>;
  /** Сохранённый свой промпт (из таба «Свой промпт»). */
  prompt?: string;
  /** Настройки конструктора промпта. */
  builderConfig?: AIBuilderConfig;
  /**
   * Столбцы, отмеченные как конфиденциальные (NDA). Их значения токенизируются
   * перед отправкой в Claude и восстанавливаются в ответе. Пусто = режим
   * конфиденциальности выключен (поведение как раньше).
   */
  confidentialColumns: string[];
  /**
   * Передавать настроенную воронку датасета в контекст AI. По умолчанию false:
   * воронка — фоновый контекст, и включается «по желанию», чтобы не сбивать
   * AI с конкретного запроса пользователя.
   */
  includeFunnel: boolean;
  runCount: number;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIProjectRun {
  id: string;
  projectId: string;
  userId: string;
  prompt: string;
  response: string;
  cost: number;
  model: AIModelId;
  inputTokens: number;
  outputTokens: number;
  /** Снимок фильтров в момент запуска. */
  filtersSnapshot: FilterCondition[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Notifications: Telegram connections, message templates, alert rules, runs
// ---------------------------------------------------------------------------

/**
 * Подключение к Telegram-боту: токен (зашифрован на бэке), целевой chat_id,
 * метаданные верификации (имя бота, заголовок чата, статус последней проверки).
 * Токен НИКОГДА не возвращается в браузер.
 */
export interface TelegramConnection {
  id: string;
  name: string;
  /** Имя бота, полученное через getMe (без @). */
  botUsername: string;
  /** Целевой chat_id (числовой ID или @username). */
  chatId: string;
  /** Заголовок чата/канала, полученный через getChat. */
  chatTitle: string;
  /** Прошёл ли бот проверку getMe + getChat. */
  isVerified: boolean;
  /** ISO-дата последней проверки/теста. */
  lastTestAt?: string;
  /** Статус последнего теста: ok | error | unknown. */
  lastTestStatus: "ok" | "error" | "unknown";
  /** Последнее сообщение об ошибке, если было. */
  lastTestError?: string;
  createdAt: string;
}

/**
 * Режимы форматирования Telegram (совпадают с `notification_templates.parse_mode`,
 * см. нижний регистр + legacy PascalCase через нормализацию при чтении).
 */
export type TelegramParseMode =
  | "none"
  | "markdown"
  | "markdownv2"
  | "html";

/**
 * Шаблон сообщения. Тело может содержать переменные вида `{var_name}`,
 * подставляемые в момент срабатывания правила.
 */
export interface NotificationTemplate {
  id: string;
  name: string;
  body: string;
  parseMode: TelegramParseMode;
  createdAt: string;
}

/** Сравнение в условии правила. */
export type AlertConditionOperator = "<" | ">" | "<=" | ">=" | "=";

/**
 * Условие правила. Discriminated union по `kind`. Старые записи без `kind`
 * считаются `threshold` (см. `normalizeAlertCondition`). Условия в правиле
 * объединяются через AND.
 */
export type AlertCondition =
  | AlertConditionThreshold
  | AlertConditionPeriodChange
  | AlertConditionVsGroupAvg
  | AlertConditionTrend;

/** Жёсткий порог: метрика (агрегат по группе за период правила) op value. */
export interface AlertConditionThreshold {
  kind?: "threshold";
  metric: string;
  operator: AlertConditionOperator;
  value: number;
}

/**
 * Сравнение метрики за два периода: ((A − B) / B) * 100 op value (в %).
 * A — последние `periodA` дней, B — последние `periodB` дней.
 */
export interface AlertConditionPeriodChange {
  kind: "period_change";
  metric: string;
  /**
   * Если задан — метрика трактуется как отношение
   * `sum(metric)/sum(metricDenominator)` за период (например CPA:
   * metric="cost", metricDenominator="installs").
   */
  metricDenominator?: string;
  periodA: number;
  periodB: number;
  operator: AlertConditionOperator;
  /** Порог изменения в процентах. */
  value: number;
}

/**
 * Сравнение метрики строки со средним по подгруппе:
 * ((value − avgByGroup) / avgByGroup) * 100 op value (в %).
 */
export interface AlertConditionVsGroupAvg {
  kind: "vs_group_avg";
  metric: string;
  /** См. AlertConditionPeriodChange.metricDenominator — отношение метрик. */
  metricDenominator?: string;
  /** Колонки подгруппы, по которым считается среднее (напр. ["channel","GEO"]). */
  groupBy: string[];
  periodDays: number;
  operator: AlertConditionOperator;
  /** Порог отклонения в процентах. */
  value: number;
}

/**
 * Тренд: метрика за `periodA` дней vs за `periodB`. `worsening` — выросла на
 * `minChangePercent`% и больше (для CPA/cost рост = ухудшение); `improving` —
 * упала на столько же. Десахарится в `period_change`.
 */
export interface AlertConditionTrend {
  kind: "trend";
  metric: string;
  /** См. AlertConditionPeriodChange.metricDenominator — отношение метрик. */
  metricDenominator?: string;
  periodA: number;
  periodB: number;
  direction: "worsening" | "improving";
  minChangePercent: number;
}

/** Возвращает `metric` условия любого типа. */
export function alertConditionMetric(c: AlertCondition): string {
  return c.metric;
}

/**
 * Нормализует `groupBy` правила к массиву колонок. Принимает строку (старый
 * формат — одна колонка или comma-separated) или массив. Чистит пробелы,
 * выкидывает пустые. Никогда не возвращает `null`/`undefined`.
 */
export function normalizeRuleGroupBy(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

/** Сериализация `groupBy` в storage-формат (comma-separated text). */
export function serializeRuleGroupBy(arr: string[]): string {
  return arr
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(",");
}

const VALID_AGGREGATIONS_NORM: AggregationType[] = [
  "SUM",
  "AVG",
  "COUNT",
  "MIN",
  "MAX",
];
const VALID_FILTER_OPERATORS_NORM: FilterCondition["operator"][] = [
  "=",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "contains",
  "in",
];

/**
 * Безопасно нормализует конфиг конструктора анализа из jsonb БД / тела запроса.
 * Никогда не бросает; всегда возвращает валидный объект с массивами.
 */
export function normalizeAnalysisConfig(input: unknown): AlertAnalysisConfig {
  const empty: AlertAnalysisConfig = {
    metrics: [],
    valueFilters: [],
    sort: null,
    topN: null,
    dateRange: null,
  };
  if (!input || typeof input !== "object") return empty;
  const r = input as Record<string, unknown>;

  const metrics: PivotValueConfig[] = Array.isArray(r.metrics)
    ? (r.metrics as unknown[]).flatMap((m) => {
        if (!m || typeof m !== "object") return [];
        const o = m as Record<string, unknown>;
        const column = typeof o.column === "string" ? o.column.trim() : "";
        if (!column) return [];
        const aggregation = VALID_AGGREGATIONS_NORM.includes(
          o.aggregation as AggregationType,
        )
          ? (o.aggregation as AggregationType)
          : "SUM";
        return [{ column, aggregation }];
      })
    : [];

  const valueFilters: FilterCondition[] = Array.isArray(r.valueFilters)
    ? (r.valueFilters as unknown[]).flatMap((f) => {
        if (!f || typeof f !== "object") return [];
        const o = f as Record<string, unknown>;
        const column = typeof o.column === "string" ? o.column.trim() : "";
        const operator = o.operator as FilterCondition["operator"];
        if (!column || !VALID_FILTER_OPERATORS_NORM.includes(operator)) return [];
        const value =
          o.value === undefined || o.value === null ? "" : String(o.value);
        const id =
          typeof o.id === "string" && o.id
            ? o.id
            : `${column}-${Math.random().toString(36).slice(2)}`;
        return [{ id, column, operator, value }];
      })
    : [];

  let sort: AlertSortConfig | null = null;
  if (r.sort && typeof r.sort === "object") {
    const s = r.sort as Record<string, unknown>;
    const column = typeof s.column === "string" ? s.column.trim() : "";
    if (column) {
      sort = { column, direction: s.direction === "asc" ? "asc" : "desc" };
    }
  }

  let topN: number | null = null;
  if (typeof r.topN === "number" && Number.isFinite(r.topN) && r.topN > 0) {
    topN = Math.floor(r.topN);
  }

  let dateRange: AlertDateRange | null = null;
  if (r.dateRange && typeof r.dateRange === "object") {
    const d = r.dateRange as Record<string, unknown>;
    const from = typeof d.from === "string" ? d.from.slice(0, 10) : "";
    const to = typeof d.to === "string" ? d.to.slice(0, 10) : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      dateRange = { from, to };
    }
  }

  let dateColumn: string | null = null;
  if (typeof r.dateColumn === "string" && r.dateColumn.trim()) {
    dateColumn = r.dateColumn.trim();
  }

  return { metrics, valueFilters, sort, topN, dateRange, dateColumn };
}

/** Является ли условие «расширенным» (period_change / vs_group_avg / trend). */
export function isAdvancedAlertCondition(c: AlertCondition): boolean {
  return (
    c.kind === "period_change" || c.kind === "vs_group_avg" || c.kind === "trend"
  );
}

/** Короткое человекочитаемое описание условия (для UI / промптов). */
function metricLabel(c: { metric: string; metricDenominator?: string }): string {
  return c.metricDenominator ? `${c.metric}/${c.metricDenominator}` : c.metric;
}

export function formatAlertCondition(c: AlertCondition): string {
  if (c.kind === "period_change")
    return `${metricLabel(c)}: изменение за ${c.periodA}д vs ${c.periodB}д ${c.operator} ${c.value}%`;
  if (c.kind === "vs_group_avg")
    return `${metricLabel(c)}: отклонение от среднего по [${c.groupBy.join(", ")}] ${c.operator} ${c.value}%`;
  if (c.kind === "trend")
    return `${metricLabel(c)}: тренд ${c.direction === "worsening" ? "ухудшение" : "улучшение"} ≥ ${c.minChangePercent}% (${c.periodA}д vs ${c.periodB}д)`;
  return `${c.metric} ${c.operator} ${c.value}`;
}

/**
 * Нормализует «сырое» условие из БД/AI в типизированное. Если `kind`
 * отсутствует или невалиден — `threshold` (обратная совместимость).
 */
export function normalizeAlertCondition(raw: unknown): AlertCondition {
  const o = (raw ?? {}) as Record<string, unknown>;
  const metric = typeof o.metric === "string" ? o.metric : "";
  const ops: AlertConditionOperator[] = ["<", ">", "<=", ">=", "="];
  const op = (v: unknown): AlertConditionOperator =>
    ops.includes(v as AlertConditionOperator) ? (v as AlertConditionOperator) : ">";
  const num = (v: unknown, def: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  const posInt = (v: unknown, def: number): number => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : def;
  };
  const kind = o.kind;
  const denom =
    typeof o.metricDenominator === "string" && o.metricDenominator
      ? o.metricDenominator
      : undefined;
  if (kind === "period_change") {
    return {
      kind: "period_change",
      metric,
      ...(denom ? { metricDenominator: denom } : {}),
      periodA: posInt(o.periodA, 7),
      periodB: posInt(o.periodB, 30),
      operator: op(o.operator),
      value: num(o.value, 20),
    };
  }
  if (kind === "vs_group_avg") {
    return {
      kind: "vs_group_avg",
      metric,
      ...(denom ? { metricDenominator: denom } : {}),
      groupBy: Array.isArray(o.groupBy)
        ? o.groupBy.filter((s): s is string => typeof s === "string")
        : [],
      periodDays: posInt(o.periodDays, 7),
      operator: op(o.operator),
      value: num(o.value, 30),
    };
  }
  if (kind === "trend") {
    return {
      kind: "trend",
      metric,
      ...(denom ? { metricDenominator: denom } : {}),
      periodA: posInt(o.periodA, 7),
      periodB: posInt(o.periodB, 30),
      direction: o.direction === "improving" ? "improving" : "worsening",
      minChangePercent: Math.abs(num(o.minChangePercent, 15)),
    };
  }
  // threshold (в т.ч. старые записи без kind)
  return { kind: "threshold", metric, operator: op(o.operator), value: num(o.value, 0) };
}

export type AlertScheduleType =
  | "daily"
  | "weekly"
  | "twice_weekly"
  | "every_n_hours"
  | "trigger_only";

/**
 * Расписание правила. Поля используются по типу:
 * - daily: time
 * - weekly / twice_weekly: time + daysOfWeek (0=ВС…6=СБ)
 * - every_n_hours: intervalHours
 * - trigger_only: запуск только вручную / по триггеру (на будущее)
 */
export interface ScheduleConfig {
  type: AlertScheduleType;
  /** Часы:минуты в выбранном часовом поясе, формат HH:MM. */
  time?: string;
  /** Дни недели, где 0=Воскресенье… 6=Суббота. */
  daysOfWeek?: number[];
  /** Каждые N часов. */
  intervalHours?: number;
  /** IANA-таймзона (например, Asia/Almaty). */
  timezone: string;
}

/** Источник создания правила: вручную или AI-генератором. */
export type AlertCreatedBy = "manual" | "ai";

/** Метаданные AI-генерации правила. */
export interface AlertAiMeta {
  /** Запрос байера, по которому правило было сгенерировано. */
  userQuery?: string;
  /** Модель Claude, использованная для генерации. */
  model?: AIModelId | "sonnet";
  /** ISO-дата генерации. */
  generatedAt?: string;
  /** Confidence из ответа AI. */
  confidence?: "high" | "med" | "low";
  /** Reasoning из ответа AI (для последней версии). */
  reasoning?: string;
  /**
   * Версия правила после итеративных доработок в AI-генераторе.
   * 1 — без доработок; инкрементируется при каждом «Применить» в секции
   * «Доработать с AI».
   */
  version?: number;
  /** Сколько раз правило дорабатывалось до сохранения. */
  refineCount?: number;
  /**
   * История предыдущих версий правила (по возрастанию версий, без вложенной
   * `history` внутри элементов — чтобы не было рекурсии). Каждый элемент —
   * снимок конфигурации правила + reasoning той версии.
   */
  history?: AlertAiRuleVersion[];
}

/** Снимок одной версии AI-правила (для истории доработок в `AlertAiMeta`). */
export interface AlertAiRuleVersion {
  version: number;
  name: string;
  description: string;
  /** Для исторических версий допускаем строку (joined) или массив. */
  groupBy: string | string[];
  periodDays: number;
  conditions: AlertCondition[];
  minSpendFilter: number | null;
  suggestedTemplateBody: string;
  confidence: "high" | "med" | "low";
  /** Объяснение AI: что было сгенерировано/изменено в этой версии. */
  reasoning: string;
}

/** Направление сортировки итоговой таблицы анализа. */
export interface AlertSortConfig {
  /**
   * Колонка сортировки. Это либо имя колонки-группировки (`code`), либо
   * ключ метрики в формате `valueKey` (`SUM(cost)`), либо имя
   * динамического плейсхолдера (`deviation_percent`).
   */
  column: string;
  direction: "asc" | "desc";
}

/** Абсолютный диапазон дат (ISO `YYYY-MM-DD`), альтернатива `periodDays`. */
export interface AlertDateRange {
  from: string;
  to: string;
}

/**
 * Конфигурация «конструктора анализа» правила — то, как строится сводная
 * таблица (pivot) при срабатывании и в превью. Опциональна: старые правила
 * без неё работают по-старому (метрики берутся из условий, без сортировки/
 * топ-N/value-фильтров). Хранится в `alert_rules.analysis_config` (jsonb).
 */
export interface AlertAnalysisConfig {
  /** Метрики таблицы: колонка (сырой столбец или ƒx) + агрегация. */
  metrics: PivotValueConfig[];
  /**
   * Фильтры по значениям полей (Источник = Meta; GEO in [UAE, EG]).
   * Применяются ДО агрегации — отбирают сущности. Используют `FilterCondition`.
   */
  valueFilters: FilterCondition[];
  /** Сортировка итоговой таблицы. `null` — без явной сортировки. */
  sort?: AlertSortConfig | null;
  /** Показать только топ-N строк. `null`/`undefined` — все строки. */
  topN?: number | null;
  /** Абсолютный диапазон дат вместо `periodDays`. `null` — использовать `periodDays`. */
  dateRange?: AlertDateRange | null;
  /**
   * Столбец датасета, по которому фильтруется период / диапазон дат.
   * `null`/`undefined` — авто-определение по имени (day/date/event_date/…).
   */
  dateColumn?: string | null;
}

/**
 * Полная конфигурация правила-алерта. Хранится в `alert_rules`
 * (RLS user_id = auth.uid()).
 */
export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  /** Активно или на паузе. Триггер отключённого правила не срабатывает. */
  isActive: boolean;
  createdBy: AlertCreatedBy;
  aiMeta?: AlertAiMeta;
  /** Привязанный датасет. */
  datasetId: string;
  /**
   * Поля группировки. Несколько колонок задают «связку», по которой
   * агрегируются метрики и формируется уникальный объект-матч (например,
   * `["channel","GEO","code"]` — отдельная строка на каждый креатив-в-связке).
   * В БД хранится как comma-separated text для совместимости со старой
   * схемой `group_by text`.
   */
  groupBy: string[];
  /** Период анализа в днях. */
  periodDays: number;
  /** Минимальный фильтр расхода (объекты с меньшим — игнорируются). */
  minSpendFilter?: number;
  /** Условия срабатывания (AND). */
  conditions: AlertCondition[];
  /** ID telegram-подключения. */
  telegramConnectionId: string;
  /** ID шаблона сообщения. */
  templateId: string;
  /** Список тегов вида "@user1, @user2" для подстановки в шаблон. */
  tagUsers?: string;
  /** Использовать ли AI-рекомендацию в сообщении. */
  useAiRecommendation: boolean;
  /** Модель Claude для AI-рекомендации. */
  aiModel?: AIModelId;
  schedule: ScheduleConfig;
  /**
   * Конфигурация конструктора анализа (сводная таблица): метрики, value-фильтры,
   * сортировка, топ-N, диапазон дат. Опциональна для обратной совместимости.
   */
  analysis?: AlertAnalysisConfig;
  /** ISO-дата последнего запуска. */
  lastRunAt?: string;
  /** Результат последнего запуска. */
  lastRunStatus?: "ok" | "error" | "no_match";
  /** Последнее сообщение (для отображения). */
  lastRunMessage?: string;
  /** ISO-дата следующего запланированного запуска. */
  nextRunAt?: string;
  createdAt: string;
}

/** Запись об одном срабатывании правила. */
export interface AlertRun {
  id: string;
  ruleId: string;
  ruleName: string;
  status: "ok" | "error" | "no_match";
  matchedCount: number;
  matchedObjects: Array<Record<string, unknown>>;
  /** Текст отправленного (или подготовленного) сообщения. */
  message: string;
  /** AI-рекомендация (если использовалась). */
  aiRecommendation?: string;
  usedAi: boolean;
  /** Длительность выполнения в миллисекундах. */
  durationMs: number;
  errorText?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// План / факт
// ---------------------------------------------------------------------------

/** «Объём» суммируется по дням (расход, установки); «ставка» — целевой уровень (CPI, ROAS). */
export const PLAN_KINDS = ["volume", "rate"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

/** «Больше — лучше», «меньше — лучше», «ближе к плану — лучше». */
export const PLAN_DIRECTIONS = ["higher", "lower", "target"] as const;
export type PlanDirection = (typeof PLAN_DIRECTIONS)[number];

/** Проверка значения из БД/ввода на допустимый элемент списка (без приведения типов вслепую). */
export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export interface PlanField {
  id: string;
  projectId: string;
  /** Подпись поля плана — из неё строятся имена виртуальных колонок. */
  label: string;
  /** Колонка датасета или имя вычисляемого поля, по которой считается факт. */
  sourceColumn: string;
  kind: PlanKind;
  direction: PlanDirection;
  format?: CalculatedFieldFormat;
  sortOrder: number;
}

export interface PlanProject {
  id: string;
  name: string;
  datasetId: string;
  dateColumn: string;
  fields: PlanField[];
  /** fieldId → месяц `YYYY-MM` → плановое значение на месяц. Нет ключа = плана нет. */
  values: Record<string, Record<string, number>>;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** То, что клиент передаёт в `/api/query`, чтобы сервер дозаполнил поля плана. */
export type PlanContext = Pick<PlanProject, "dateColumn" | "fields" | "values">;

export type PlanVirtualKind =
  | "plan"
  | "planToDate"
  | "completion"
  | "forecast"
  | "deviation";
