import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { mapClickhouseType } from "@/lib/type-mapping";
import { FILE_TABLE } from "@/lib/file-constants";
import { KEY_COLUMN, PROVIDER_LIST, type AIProvider } from "@/lib/ai-models";
import {
  CALCULATED_FIELD_FORMATS,
  PLAN_DIRECTIONS,
  PLAN_KINDS,
  isOneOf,
} from "@/lib/types";
import type {
  AIAnalysis,
  AIBuilderConfig,
  AIModelId,
  AIProject,
  AIProjectRun,
  CalculatedField,
  Dashboard,
  DashboardFilter,
  DashboardSheet,
  DashboardWidget,
  DashboardWidgetType,
  DashboardWidgetWidth,
  DataSource,
  Dataset,
  DatasetColumn,
  FilterCondition,
  FunnelStep,
  KpiProfile,
  PlanField,
  PlanProject,
  QueryResultRow,
  Visualization,
  VisualizationConfig,
  VisualizationType,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// User settings
// ---------------------------------------------------------------------------

export interface UserSettings {
  theme: "dark" | "light";
  /** Маркер наличия ключа по провайдеру (значение из БД — зашифрованное). */
  providerKeys: Record<AIProvider, string>;
}

// ---------------------------------------------------------------------------
// Row shapes (Supabase representation). Type-safe mapping to/from frontend
// types. All columns match `supabase/schema-data.sql`.
// ---------------------------------------------------------------------------

interface DataSourceRow {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  host: string;
  port: number;
  database_name: string;
  username: string;
  password_encrypted: string;
  ssl: boolean;
  status: string;
  status_message: string | null;
  tables: string[] | null;
  is_demo?: boolean | null;
  kind?: string | null;
  created_at: string;
  updated_at?: string | null;
  /** Встроенная связь file_sources (для файловых источников). Supabase отдаёт
   *  объект (PK = data_source_id, связь one-to-one) либо массив — нормализуем. */
  file_sources?:
    | {
        format?: string | null;
        mode?: string | null;
        last_refreshed_at?: string | null;
      }
    | {
        format?: string | null;
        mode?: string | null;
        last_refreshed_at?: string | null;
      }[]
    | null;
}

interface DatasetRow {
  id: string;
  user_id: string;
  data_source_id: string;
  name: string;
  table_name: string | null;
  sql_query: string | null;
  columns: DatasetColumn[] | null;
  calculated_fields: CalculatedField[] | null;
  row_count: number | null;
  business_context: string | null;
  /**
   * После миграции — `JSONB NOT NULL DEFAULT '{}'`. Для старых строк
   * (если по какой-то причине пришёл null) нормализуем в `{}`.
   */
  kpi_profile: KpiProfile | null;
  funnel_steps: FunnelStep[] | null;
  created_at: string;
}

interface VisualizationRow {
  id: string;
  user_id: string;
  dataset_id: string;
  name: string;
  type: VisualizationType;
  config: VisualizationConfig;
  /**
   * Вычисляемые поля, живущие только внутри этой визуализации.
   * После миграции 003 — `JSONB NOT NULL DEFAULT '[]'`. Для старых
   * строк / отсутствующего поля нормализуем в `[]`.
   */
  visualization_calculated_fields: CalculatedField[] | null;
  created_at: string;
}

interface AIAnalysisRow {
  id: string;
  user_id: string;
  data_type: "dataset" | "visualization";
  data_id: string;
  prompt: string;
  response: string;
  cost: number;
  model: string | null;
  created_at: string;
}

interface UserSettingsRow {
  user_id: string;
  theme: "dark" | "light";
  anthropic_api_key: string;
  openai_api_key?: string;
  google_api_key?: string;
  groq_api_key?: string;
  cerebras_api_key?: string;
  mistral_api_key?: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapError(context: string, message: string): Error {
  return new Error(`${context}: ${message}`);
}

function rowToDataSource(row: DataSourceRow): DataSource {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    host: row.host,
    port: row.port,
    database: row.database_name,
    user: row.username,
    password: row.password_encrypted,
    ssl: row.ssl,
    status:
      row.status === "connected" || row.status === "error"
        ? row.status
        : "unknown",
    statusMessage: row.status_message ?? undefined,
    createdAt: row.created_at,
    tables: row.tables ?? [],
    // Реальные источники из Supabase никогда не помечаются как демо —
    // демо-источник живёт in-memory и в БД не сохраняется. Колонка
    // is_demo нужна только для совместимости со схемой.
    isDemo: row.is_demo === true ? true : false,
    kind: row.kind === "file" ? "file" : "clickhouse",
    ...fileMetaOf(row.file_sources),
  };
}

/** Нормализует встроенную связь file_sources (объект/массив) в поля DataSource. */
function fileMetaOf(fs: DataSourceRow["file_sources"]): {
  fileFormat?: string;
  fileMode?: "snapshot" | "live";
  lastRefreshedAt?: string | null;
} {
  const row = Array.isArray(fs) ? fs[0] : fs;
  if (!row) return {};
  return {
    fileFormat: row.format ?? undefined,
    fileMode: row.mode === "live" ? "live" : "snapshot",
    lastRefreshedAt: row.last_refreshed_at ?? null,
  };
}

function dataSourceToInsert(
  userId: string,
  source: Omit<DataSource, "id">,
): Record<string, unknown> {
  return {
    user_id: userId,
    name: source.name,
    description: source.description ?? null,
    host: source.host,
    port: source.port,
    database_name: source.database,
    username: source.user,
    password_encrypted: source.password,
    ssl: source.ssl,
    status: source.status,
    status_message: source.statusMessage ?? null,
    tables: source.tables ?? [],
    created_at: source.createdAt,
  };
}

function dataSourcePatchToUpdate(
  patch: Partial<DataSource>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.description !== undefined)
    out.description = patch.description ?? null;
  if (patch.host !== undefined) out.host = patch.host;
  if (patch.port !== undefined) out.port = patch.port;
  if (patch.database !== undefined) out.database_name = patch.database;
  if (patch.user !== undefined) out.username = patch.user;
  if (patch.password !== undefined) out.password_encrypted = patch.password;
  if (patch.ssl !== undefined) out.ssl = patch.ssl;
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.statusMessage !== undefined)
    out.status_message = patch.statusMessage ?? null;
  if (patch.tables !== undefined) out.tables = patch.tables ?? [];
  // Если в схеме есть колонка updated_at — обновим её. Если её ещё нет
  // (старые проекты до schema-fix-datasources.sql), Supabase вернёт ошибку
  // на уровне запроса — поэтому пишем только когда колонка точно есть.
  // Подход: всегда писать, миграция добавит колонку через ALTER TABLE.
  out.updated_at = new Date().toISOString();
  return out;
}

/**
 * Единый контекст столбца для AI хранится в `businessContext`.
 * Подтягиваем данные из устаревших полей `aiDescription` и `description`,
 * чтобы не потерять старые датасеты.
 */
export function normalizeDatasetColumnsFromStorage(
  raw: DatasetColumn[] | null | undefined,
): DatasetColumn[] {
  const rawColumns = Array.isArray(raw) ? raw : [];
  return rawColumns.map((c) => {
    let businessContext =
      typeof c.businessContext === "string" ? c.businessContext : "";
    const aiLegacy =
      typeof c.aiDescription === "string" ? c.aiDescription.trim() : "";
    const descLegacy =
      typeof c.description === "string" ? c.description.trim() : "";
    if (!businessContext.trim() && aiLegacy) {
      businessContext = aiLegacy;
    }
    if (!businessContext.trim() && descLegacy) {
      businessContext = descLegacy;
    }
    if (c.isAutoDetected !== undefined) {
      return { ...c, businessContext };
    }
    if (!c.clickhouseType) {
      return { ...c, businessContext, isAutoDetected: true };
    }
    const auto = mapClickhouseType(c.clickhouseType);
    return {
      ...c,
      businessContext,
      isAutoDetected: c.datasetType === auto,
    };
  });
}

function rowToDataset(row: DatasetRow): Dataset {
  const columns = normalizeDatasetColumnsFromStorage(
    Array.isArray(row.columns) ? row.columns : [],
  );
  // kpi_profile после миграции NOT NULL DEFAULT '{}'. На уровне ts мы
  // всё равно подстраховываемся: и null, и не-объект (на всякий случай
  // от грязных JSONB) превращаем в пустой профиль.
  const kpiProfile: KpiProfile =
    row.kpi_profile && typeof row.kpi_profile === "object"
      ? row.kpi_profile
      : {};
  return {
    id: row.id,
    name: row.name,
    dataSourceId: row.data_source_id,
    table: row.table_name,
    sqlQuery: row.sql_query,
    columns,
    createdAt: row.created_at,
    rowCount: row.row_count ?? undefined,
    calculatedFields: Array.isArray(row.calculated_fields)
      ? row.calculated_fields
      : [],
    businessContext: row.business_context ?? "",
    kpiProfile,
    funnelSteps: Array.isArray(row.funnel_steps) ? row.funnel_steps : undefined,
  };
}

function datasetToInsert(
  userId: string,
  dataset: Omit<Dataset, "id">,
): Record<string, unknown> {
  return {
    user_id: userId,
    data_source_id: dataset.dataSourceId,
    name: dataset.name,
    table_name: dataset.table,
    sql_query: dataset.sqlQuery,
    columns: dataset.columns,
    calculated_fields: dataset.calculatedFields,
    row_count: dataset.rowCount ?? null,
    // После миграции колонки NOT NULL DEFAULT — посылаем всегда не-null.
    business_context: dataset.businessContext ?? "",
    kpi_profile: dataset.kpiProfile ?? {},
    funnel_steps: dataset.funnelSteps ?? null,
    created_at: dataset.createdAt,
  };
}

function datasetPatchToUpdate(
  patch: Partial<Dataset>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.dataSourceId !== undefined) out.data_source_id = patch.dataSourceId;
  if (patch.table !== undefined) out.table_name = patch.table;
  if (patch.sqlQuery !== undefined) out.sql_query = patch.sqlQuery;
  if (patch.columns !== undefined) out.columns = patch.columns;
  if (patch.calculatedFields !== undefined)
    out.calculated_fields = patch.calculatedFields;
  if (patch.rowCount !== undefined) out.row_count = patch.rowCount ?? null;
  // business_context и kpi_profile после миграции NOT NULL DEFAULT —
  // никогда не отправляем `null`, только реальное значение или пустое.
  if (patch.businessContext !== undefined)
    out.business_context = patch.businessContext ?? "";
  if (patch.kpiProfile !== undefined) out.kpi_profile = patch.kpiProfile ?? {};
  if (patch.funnelSteps !== undefined)
    out.funnel_steps = patch.funnelSteps ?? null;
  return out;
}

function rowToVisualization(row: VisualizationRow): Visualization {
  return {
    id: row.id,
    name: row.name,
    datasetId: row.dataset_id,
    type: row.type,
    config: row.config,
    calculatedFields: Array.isArray(row.visualization_calculated_fields)
      ? row.visualization_calculated_fields
      : [],
    createdAt: row.created_at,
  };
}

function visualizationToInsert(
  userId: string,
  viz: Omit<Visualization, "id">,
): Record<string, unknown> {
  return {
    user_id: userId,
    dataset_id: viz.datasetId,
    name: viz.name,
    type: viz.type,
    config: viz.config,
    visualization_calculated_fields: viz.calculatedFields ?? [],
    created_at: viz.createdAt,
  };
}

function visualizationPatchToUpdate(
  patch: Partial<Visualization>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.datasetId !== undefined) out.dataset_id = patch.datasetId;
  if (patch.type !== undefined) out.type = patch.type;
  if (patch.config !== undefined) out.config = patch.config;
  if (patch.calculatedFields !== undefined)
    out.visualization_calculated_fields = patch.calculatedFields;
  return out;
}

function rowToAnalysis(row: AIAnalysisRow): AIAnalysis {
  const m = row.model;
  return {
    id: row.id,
    dataType: row.data_type,
    dataId: row.data_id,
    prompt: row.prompt,
    response: row.response,
    cost: Number(row.cost) || 0,
    createdAt: row.created_at,
    model:
      m === "haiku" || m === "sonnet" || m === "opus" ? m : undefined,
  };
}

function analysisToInsert(
  userId: string,
  a: Omit<AIAnalysis, "id">,
): Record<string, unknown> {
  return {
    user_id: userId,
    data_type: a.dataType,
    data_id: a.dataId,
    prompt: a.prompt,
    response: a.response,
    cost: a.cost,
    model: a.model ?? null,
    created_at: a.createdAt,
  };
}

function rowToSettings(row: UserSettingsRow): UserSettings {
  const r = row as unknown as Record<string, string | undefined>;
  const providerKeys = {} as Record<AIProvider, string>;
  for (const p of PROVIDER_LIST) providerKeys[p] = r[KEY_COLUMN[p]] ?? "";
  return {
    // Тёмная — только явный выбор; всё остальное (null, мусор) — светлая.
    theme: row.theme === "dark" ? "dark" : "light",
    providerKeys,
  };
}

// ---------------------------------------------------------------------------
// data_sources
// ---------------------------------------------------------------------------

export async function getDataSources(
  userId: string,
  client?: SupabaseClient,
): Promise<DataSource[]> {
  const supabase = client ?? getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("data_sources")
    .select("*, file_sources(format, mode, last_refreshed_at)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw wrapError("Не удалось загрузить источники", error.message);
  return (data as DataSourceRow[] | null ?? []).map(rowToDataSource);
}

export async function createDataSource(
  userId: string,
  source: Omit<DataSource, "id">,
): Promise<DataSource> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("data_sources")
    .insert(dataSourceToInsert(userId, source))
    .select()
    .single();
  if (error || !data)
    throw wrapError(
      "Не удалось создать источник",
      error?.message ?? "нет данных",
    );
  return rowToDataSource(data as DataSourceRow);
}

/**
 * Создаёт файловый источник (CSV/Excel/Google Sheets): строка в data_sources
 * (kind='file', плейсхолдеры подключения), строки в file_sources и сразу
 * датасет (одна логическая таблица). Возвращает источник + id датасета.
 */
export async function createFileDataSource(
  userId: string,
  payload: {
    name: string;
    description?: string;
    format: "csv" | "excel" | "gsheet";
    columns: { name: string; type: DatasetColumn["datasetType"] }[];
    rows: QueryResultRow[];
    sourceMeta?: Record<string, unknown>;
    /** 'live' (Google Sheets) — строки в БД не храним, тянем по ссылке. */
    mode?: "snapshot" | "live";
  },
  client?: SupabaseClient,
): Promise<{ source: DataSource; datasetId: string }> {
  const supabase = client ?? getSupabaseBrowserClient();
  const nowIso = new Date().toISOString();
  // Живой режим: строки в БД не сохраняем (rows=[]), данные тянутся по ссылке.
  const isLive = payload.mode === "live";
  const storedRows = isLive ? [] : payload.rows;

  // 1) источник (kind=file, плейсхолдеры — реального подключения нет)
  const { data: srcRow, error: srcErr } = await supabase
    .from("data_sources")
    .insert({
      user_id: userId,
      name: payload.name,
      description: payload.description ?? null,
      host: "file",
      port: 0,
      database_name: "file",
      username: "file",
      password_encrypted: "",
      ssl: false,
      status: "connected",
      is_demo: false,
      kind: "file",
      tables: [FILE_TABLE],
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select()
    .single();
  if (srcErr || !srcRow)
    throw wrapError("Не удалось создать источник", srcErr?.message ?? "нет данных");
  const source = rowToDataSource(srcRow as DataSourceRow);

  // 2) распарсенные строки
  const { error: fsErr } = await supabase.from("file_sources").insert({
    data_source_id: source.id,
    user_id: userId,
    format: payload.format,
    columns: payload.columns.map((c) => ({ name: c.name, type: c.type })),
    rows: storedRows,
    row_count: storedRows.length,
    source_meta: payload.sourceMeta ?? null,
    mode: payload.mode ?? "snapshot",
    last_refreshed_at: isLive ? null : nowIso,
  });
  if (fsErr) {
    // откат — не оставляем «пустой» источник
    await supabase.from("data_sources").delete().eq("id", source.id);
    throw wrapError("Не удалось сохранить данные файла", fsErr.message);
  }

  // 3) датасет (одна таблица; типы столбцов из инференса)
  const datasetColumns: DatasetColumn[] = payload.columns.map((c) => ({
    name: c.name,
    clickhouseType: c.type,
    datasetType: c.type,
    description: "",
    businessContext: "",
    enabled: true,
    isAutoDetected: true,
  }));
  let datasetId: string;
  try {
    const created = await createDataset(userId, {
      name: payload.name,
      dataSourceId: source.id,
      table: FILE_TABLE,
      sqlQuery: null,
      columns: datasetColumns,
      createdAt: nowIso,
      rowCount: payload.rows.length,
      calculatedFields: [],
      businessContext: "",
      kpiProfile: {},
    }, client);
    datasetId = created.id;
  } catch (e) {
    // источник и данные созданы, но датасет нет — сообщаем, не откатывая данные
    throw wrapError(
      "Источник создан, но датасет не удалось создать",
      e instanceof Error ? e.message : String(e),
    );
  }
  return { source, datasetId };
}

export async function updateDataSource(
  id: string,
  updates: Partial<DataSource>,
): Promise<DataSource> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("data_sources")
    .update(dataSourcePatchToUpdate(updates))
    .eq("id", id)
    .select()
    .single();
  if (error || !data)
    throw wrapError(
      "Не удалось обновить источник",
      error?.message ?? "нет данных",
    );
  return rowToDataSource(data as DataSourceRow);
}

export async function deleteDataSource(id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("data_sources").delete().eq("id", id);
  if (error) throw wrapError("Не удалось удалить источник", error.message);
}

// ---------------------------------------------------------------------------
// datasets
// ---------------------------------------------------------------------------

export async function getDatasets(
  userId: string,
  client?: SupabaseClient,
): Promise<Dataset[]> {
  const supabase = client ?? getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("datasets")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw wrapError("Не удалось загрузить датасеты", error.message);
  return (data as DatasetRow[] | null ?? []).map(rowToDataset);
}

export async function createDataset(
  userId: string,
  dataset: Omit<Dataset, "id">,
  client?: SupabaseClient,
): Promise<Dataset> {
  const supabase = client ?? getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("datasets")
    .insert(datasetToInsert(userId, dataset))
    .select()
    .single();
  if (error || !data)
    throw wrapError(
      "Не удалось создать датасет",
      error?.message ?? "нет данных",
    );
  return rowToDataset(data as DatasetRow);
}

export async function updateDataset(
  id: string,
  updates: Partial<Dataset>,
): Promise<Dataset> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("datasets")
    .update(datasetPatchToUpdate(updates))
    .eq("id", id)
    .select()
    .single();
  if (error || !data)
    throw wrapError(
      "Не удалось обновить датасет",
      error?.message ?? "нет данных",
    );
  return rowToDataset(data as DatasetRow);
}

export async function deleteDataset(id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("datasets").delete().eq("id", id);
  if (error) throw wrapError("Не удалось удалить датасет", error.message);
}

// ---------------------------------------------------------------------------
// visualizations
// ---------------------------------------------------------------------------

export async function getVisualizations(
  userId: string,
  client?: SupabaseClient,
): Promise<Visualization[]> {
  const supabase = client ?? getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("visualizations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error)
    throw wrapError("Не удалось загрузить визуализации", error.message);
  return (data as VisualizationRow[] | null ?? []).map(rowToVisualization);
}

export async function createVisualization(
  userId: string,
  viz: Omit<Visualization, "id">,
): Promise<Visualization> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("visualizations")
    .insert(visualizationToInsert(userId, viz))
    .select()
    .single();
  if (error || !data)
    throw wrapError(
      "Не удалось создать визуализацию",
      error?.message ?? "нет данных",
    );
  return rowToVisualization(data as VisualizationRow);
}

export async function updateVisualization(
  id: string,
  updates: Partial<Visualization>,
): Promise<Visualization> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("visualizations")
    .update(visualizationPatchToUpdate(updates))
    .eq("id", id)
    .select()
    .single();
  if (error || !data)
    throw wrapError(
      "Не удалось обновить визуализацию",
      error?.message ?? "нет данных",
    );
  return rowToVisualization(data as VisualizationRow);
}

export async function deleteVisualization(id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("visualizations").delete().eq("id", id);
  if (error) throw wrapError("Не удалось удалить визуализацию", error.message);
}

// ---------------------------------------------------------------------------
// ai_analyses
// ---------------------------------------------------------------------------

export async function getAnalyses(
  userId: string,
  limit = 50,
  client?: SupabaseClient,
): Promise<AIAnalysis[]> {
  const supabase = client ?? getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("ai_analyses")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error)
    throw wrapError("Не удалось загрузить историю анализов", error.message);
  return (data as AIAnalysisRow[] | null ?? []).map(rowToAnalysis);
}

export async function createAnalysis(
  userId: string,
  analysis: Omit<AIAnalysis, "id">,
): Promise<AIAnalysis> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("ai_analyses")
    .insert(analysisToInsert(userId, analysis))
    .select()
    .single();
  if (error || !data)
    throw wrapError(
      "Не удалось сохранить анализ",
      error?.message ?? "нет данных",
    );
  return rowToAnalysis(data as AIAnalysisRow);
}

export async function deleteAnalysis(id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("ai_analyses").delete().eq("id", id);
  if (error) throw wrapError("Не удалось удалить анализ", error.message);
}

export async function clearAnalyses(userId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from("ai_analyses")
    .delete()
    .eq("user_id", userId);
  if (error)
    throw wrapError("Не удалось очистить историю анализов", error.message);
}

// ---------------------------------------------------------------------------
// user_settings
// ---------------------------------------------------------------------------

export async function getUserSettings(
  userId: string,
  client?: SupabaseClient,
): Promise<UserSettings | null> {
  const supabase = client ?? getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw wrapError("Не удалось загрузить настройки", error.message);
  if (!data) return null;
  return rowToSettings(data as UserSettingsRow);
}

// ---------------------------------------------------------------------------
// dashboards / dashboard_sheets / dashboard_widgets
// ---------------------------------------------------------------------------

interface DashboardRow {
  id: string;
  user_id: string;
  dataset_id: string;
  name: string;
  description: string | null;
  filters_config: DashboardFilter[] | null;
  created_at: string;
  updated_at: string;
}

interface DashboardSheetRow {
  id: string;
  dashboard_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

interface DashboardWidgetRow {
  id: string;
  sheet_id: string;
  visualization_id: string | null;
  widget_type: DashboardWidgetType;
  title: string;
  config: Record<string, unknown> | null;
  sort_order: number;
  width: DashboardWidgetWidth;
  created_at: string;
}

function rowToDashboard(
  row: DashboardRow,
  sheets: DashboardSheet[] = [],
): Dashboard {
  return {
    id: row.id,
    userId: row.user_id,
    datasetId: row.dataset_id,
    name: row.name,
    description: row.description ?? undefined,
    filtersConfig: Array.isArray(row.filters_config) ? row.filters_config : [],
    sheets,
    sheetsCount: (row as { dashboard_sheets?: { count: number }[] }).dashboard_sheets?.[0]?.count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSheet(
  row: DashboardSheetRow,
  widgets: DashboardWidget[] = [],
): DashboardSheet {
  return {
    id: row.id,
    dashboardId: row.dashboard_id,
    name: row.name,
    sortOrder: row.sort_order,
    widgets,
  };
}

function rowToWidget(row: DashboardWidgetRow): DashboardWidget {
  return {
    id: row.id,
    sheetId: row.sheet_id,
    visualizationId: row.visualization_id ?? undefined,
    widgetType: row.widget_type,
    title: row.title,
    config: (row.config as Record<string, unknown>) ?? {},
    sortOrder: row.sort_order,
    width: row.width,
  };
}

export async function getDashboards(
  userId: string,
  client?: SupabaseClient,
): Promise<Dashboard[]> {
  const supabase = client ?? getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("dashboards")
    // Листы в списке не нужны целиком — только счётчик для карточки.
    .select("*, dashboard_sheets(count)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw wrapError("Не удалось загрузить дашборды", error.message);
  return (data as DashboardRow[] | null ?? []).map((r) => rowToDashboard(r, []));
}

export async function getDashboard(id: string): Promise<Dashboard | null> {
  const supabase = getSupabaseBrowserClient();
  const { data: dashRow, error: dashErr } = await supabase
    .from("dashboards")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (dashErr) throw wrapError("Не удалось загрузить дашборд", dashErr.message);
  if (!dashRow) return null;

  const { data: sheetRows, error: sheetErr } = await supabase
    .from("dashboard_sheets")
    .select("*")
    .eq("dashboard_id", id)
    .order("sort_order", { ascending: true });
  if (sheetErr)
    throw wrapError("Не удалось загрузить листы", sheetErr.message);

  const sheetsArr = (sheetRows as DashboardSheetRow[] | null) ?? [];
  const sheetIds = sheetsArr.map((s) => s.id);

  let widgetRows: DashboardWidgetRow[] = [];
  if (sheetIds.length > 0) {
    const { data: wRows, error: wErr } = await supabase
      .from("dashboard_widgets")
      .select("*")
      .in("sheet_id", sheetIds)
      .order("sort_order", { ascending: true });
    if (wErr) throw wrapError("Не удалось загрузить виджеты", wErr.message);
    widgetRows = (wRows as DashboardWidgetRow[] | null) ?? [];
  }

  const widgetsBySheet = new Map<string, DashboardWidget[]>();
  for (const row of widgetRows) {
    const list = widgetsBySheet.get(row.sheet_id) ?? [];
    list.push(rowToWidget(row));
    widgetsBySheet.set(row.sheet_id, list);
  }

  const sheets = sheetsArr.map((s) =>
    rowToSheet(s, widgetsBySheet.get(s.id) ?? []),
  );
  return rowToDashboard(dashRow as DashboardRow, sheets);
}

export async function createDashboard(
  userId: string,
  data: {
    datasetId: string;
    name: string;
    description?: string;
    filtersConfig?: DashboardFilter[];
  },
): Promise<Dashboard> {
  const supabase = getSupabaseBrowserClient();
  const nowIso = new Date().toISOString();
  const { data: dashRow, error: dashErr } = await supabase
    .from("dashboards")
    .insert({
      user_id: userId,
      dataset_id: data.datasetId,
      name: data.name,
      description: data.description ?? null,
      filters_config: data.filtersConfig ?? [],
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select()
    .single();
  if (dashErr || !dashRow)
    throw wrapError(
      "Не удалось создать дашборд",
      dashErr?.message ?? "нет данных",
    );
  const dashboard = rowToDashboard(dashRow as DashboardRow, []);

  // Автоматически создаём первый лист "Лист 1".
  const firstSheet = await createSheet(dashboard.id, "Лист 1");
  dashboard.sheets = [firstSheet];
  return dashboard;
}

export async function updateDashboard(
  id: string,
  updates: Partial<Omit<Dashboard, "sheets" | "userId" | "createdAt">>,
): Promise<Dashboard> {
  const supabase = getSupabaseBrowserClient();
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.description !== undefined)
    payload.description = updates.description ?? null;
  if (updates.datasetId !== undefined) payload.dataset_id = updates.datasetId;
  if (updates.filtersConfig !== undefined)
    payload.filters_config = updates.filtersConfig;

  const { data, error } = await supabase
    .from("dashboards")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error || !data)
    throw wrapError(
      "Не удалось обновить дашборд",
      error?.message ?? "нет данных",
    );
  return rowToDashboard(data as DashboardRow, []);
}

export async function deleteDashboard(id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("dashboards").delete().eq("id", id);
  if (error) throw wrapError("Не удалось удалить дашборд", error.message);
}

export async function createSheet(
  dashboardId: string,
  name: string,
): Promise<DashboardSheet> {
  const supabase = getSupabaseBrowserClient();
  const { data: existing } = await supabase
    .from("dashboard_sheets")
    .select("sort_order")
    .eq("dashboard_id", dashboardId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort =
    Array.isArray(existing) && existing.length > 0
      ? ((existing[0] as { sort_order: number }).sort_order ?? 0) + 1
      : 0;
  const { data, error } = await supabase
    .from("dashboard_sheets")
    .insert({
      dashboard_id: dashboardId,
      name,
      sort_order: nextSort,
    })
    .select()
    .single();
  if (error || !data)
    throw wrapError(
      "Не удалось создать лист",
      error?.message ?? "нет данных",
    );
  return rowToSheet(data as DashboardSheetRow, []);
}

export async function updateSheet(
  id: string,
  updates: Partial<Pick<DashboardSheet, "name" | "sortOrder">>,
): Promise<DashboardSheet> {
  const supabase = getSupabaseBrowserClient();
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.sortOrder !== undefined) payload.sort_order = updates.sortOrder;
  const { data, error } = await supabase
    .from("dashboard_sheets")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error || !data)
    throw wrapError(
      "Не удалось обновить лист",
      error?.message ?? "нет данных",
    );
  return rowToSheet(data as DashboardSheetRow, []);
}

export async function deleteSheet(id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from("dashboard_sheets")
    .delete()
    .eq("id", id);
  if (error) throw wrapError("Не удалось удалить лист", error.message);
}

export async function createWidget(
  sheetId: string,
  widget: Omit<DashboardWidget, "id" | "sheetId">,
): Promise<DashboardWidget> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("dashboard_widgets")
    .insert({
      sheet_id: sheetId,
      visualization_id: widget.visualizationId ?? null,
      widget_type: widget.widgetType,
      title: widget.title,
      config: widget.config ?? {},
      sort_order: widget.sortOrder,
      width: widget.width,
    })
    .select()
    .single();
  if (error || !data)
    throw wrapError(
      "Не удалось создать виджет",
      error?.message ?? "нет данных",
    );
  return rowToWidget(data as DashboardWidgetRow);
}

export async function updateWidget(
  id: string,
  updates: Partial<Omit<DashboardWidget, "id" | "sheetId">>,
): Promise<DashboardWidget> {
  const supabase = getSupabaseBrowserClient();
  const payload: Record<string, unknown> = {};
  if (updates.visualizationId !== undefined)
    payload.visualization_id = updates.visualizationId ?? null;
  if (updates.widgetType !== undefined) payload.widget_type = updates.widgetType;
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.config !== undefined) payload.config = updates.config;
  if (updates.sortOrder !== undefined) payload.sort_order = updates.sortOrder;
  if (updates.width !== undefined) payload.width = updates.width;
  const { data, error } = await supabase
    .from("dashboard_widgets")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error || !data)
    throw wrapError(
      "Не удалось обновить виджет",
      error?.message ?? "нет данных",
    );
  return rowToWidget(data as DashboardWidgetRow);
}

export async function deleteWidget(id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from("dashboard_widgets")
    .delete()
    .eq("id", id);
  if (error) throw wrapError("Не удалось удалить виджет", error.message);
}

export async function reorderWidgets(
  items: { id: string; sortOrder: number }[],
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  // Supabase не поддерживает bulk-update с разными значениями в одном запросе,
  // поэтому последовательно обновляем каждую запись.
  for (const it of items) {
    const { error } = await supabase
      .from("dashboard_widgets")
      .update({ sort_order: it.sortOrder })
      .eq("id", it.id);
    if (error)
      throw wrapError("Не удалось переупорядочить виджеты", error.message);
  }
}

// ---------------------------------------------------------------------------
// ai_projects / ai_project_runs
// ---------------------------------------------------------------------------

interface AIProjectRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  dataset_id: string;
  model: string;
  filters_config: DashboardFilter[] | null;
  filter_values: Record<string, unknown> | null;
  prompt: string | null;
  builder_config: AIBuilderConfig | null;
  confidential_columns: string[] | null;
  include_funnel: boolean | null;
  created_at: string;
  updated_at: string;
}

interface AIProjectRunRow {
  id: string;
  project_id: string;
  user_id: string;
  prompt: string;
  response: string;
  cost: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  filters_snapshot: FilterCondition[] | null;
  created_at: string;
}

function parseModel(m: string | null | undefined): AIModelId {
  return m === "haiku" || m === "sonnet" || m === "opus" ? m : "sonnet";
}

function rowToProject(
  row: AIProjectRow,
  runCount = 0,
  lastRunAt?: string,
): AIProject {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description ?? undefined,
    datasetId: row.dataset_id,
    model: parseModel(row.model),
    filtersConfig: Array.isArray(row.filters_config) ? row.filters_config : [],
    filterValues:
      row.filter_values && typeof row.filter_values === "object"
        ? row.filter_values
        : {},
    prompt: row.prompt ?? undefined,
    builderConfig: row.builder_config ?? undefined,
    confidentialColumns: Array.isArray(row.confidential_columns)
      ? row.confidential_columns
      : [],
    includeFunnel: row.include_funnel === true,
    runCount,
    lastRunAt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToProjectRun(row: AIProjectRunRow): AIProjectRun {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    prompt: row.prompt,
    response: row.response,
    cost: Number(row.cost) || 0,
    model: parseModel(row.model),
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    filtersSnapshot: Array.isArray(row.filters_snapshot)
      ? row.filters_snapshot
      : [],
    createdAt: row.created_at,
  };
}

export async function getAiProjects(
  userId: string,
  client?: SupabaseClient,
): Promise<AIProject[]> {
  const supabase = client ?? getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("ai_projects")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw wrapError("Не удалось загрузить проекты", error.message);
  const projects = (data as AIProjectRow[] | null) ?? [];
  if (projects.length === 0) return [];

  // Получаем aggregate-счётчик запусков и дату последнего для каждого проекта.
  const ids = projects.map((p) => p.id);
  const { data: runStats } = await supabase
    .from("ai_project_runs")
    .select("project_id, created_at")
    .in("project_id", ids)
    .order("created_at", { ascending: false });

  const statsMap = new Map<string, { count: number; last: string }>();
  for (const r of (runStats as { project_id: string; created_at: string }[] | null) ?? []) {
    const cur = statsMap.get(r.project_id);
    if (cur) {
      cur.count += 1;
    } else {
      statsMap.set(r.project_id, { count: 1, last: r.created_at });
    }
  }

  return projects.map((p) => {
    const stats = statsMap.get(p.id);
    return rowToProject(p, stats?.count ?? 0, stats?.last);
  });
}

export async function getAiProject(id: string): Promise<AIProject | null> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("ai_projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw wrapError("Не удалось загрузить проект", error.message);
  if (!data) return null;

  const { data: runStats } = await supabase
    .from("ai_project_runs")
    .select("created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false });
  const arr = (runStats as { created_at: string }[] | null) ?? [];
  return rowToProject(data as AIProjectRow, arr.length, arr[0]?.created_at);
}

export async function createAiProject(
  userId: string,
  data: {
    name: string;
    description?: string;
    datasetId: string;
    model?: AIModelId;
  },
): Promise<AIProject> {
  const supabase = getSupabaseBrowserClient();
  const nowIso = new Date().toISOString();
  const { data: row, error } = await supabase
    .from("ai_projects")
    .insert({
      user_id: userId,
      name: data.name,
      description: data.description ?? null,
      dataset_id: data.datasetId,
      model: data.model ?? "sonnet",
      filters_config: [],
      filter_values: {},
      prompt: null,
      builder_config: null,
      confidential_columns: [],
      include_funnel: false,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select()
    .single();
  if (error || !row)
    throw wrapError(
      "Не удалось создать проект",
      error?.message ?? "нет данных",
    );
  return rowToProject(row as AIProjectRow, 0, undefined);
}

export async function updateAiProject(
  id: string,
  updates: Partial<
    Pick<
      AIProject,
      | "name"
      | "description"
      | "datasetId"
      | "model"
      | "filtersConfig"
      | "filterValues"
      | "prompt"
      | "builderConfig"
      | "confidentialColumns"
      | "includeFunnel"
    >
  >,
): Promise<AIProject> {
  const supabase = getSupabaseBrowserClient();
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.description !== undefined)
    payload.description = updates.description ?? null;
  if (updates.datasetId !== undefined) payload.dataset_id = updates.datasetId;
  if (updates.model !== undefined) payload.model = updates.model;
  if (updates.filtersConfig !== undefined)
    payload.filters_config = updates.filtersConfig;
  if (updates.filterValues !== undefined)
    payload.filter_values = updates.filterValues;
  if (updates.prompt !== undefined) payload.prompt = updates.prompt ?? null;
  if (updates.builderConfig !== undefined)
    payload.builder_config = updates.builderConfig ?? null;
  if (updates.confidentialColumns !== undefined)
    payload.confidential_columns = updates.confidentialColumns;
  if (updates.includeFunnel !== undefined)
    payload.include_funnel = updates.includeFunnel;

  const { data, error } = await supabase
    .from("ai_projects")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error || !data)
    throw wrapError(
      "Не удалось обновить проект",
      error?.message ?? "нет данных",
    );
  return rowToProject(data as AIProjectRow);
}

export async function deleteAiProject(id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("ai_projects").delete().eq("id", id);
  if (error) throw wrapError("Не удалось удалить проект", error.message);
}

export async function duplicateAiProject(
  userId: string,
  sourceId: string,
): Promise<AIProject> {
  const source = await getAiProject(sourceId);
  if (!source) throw new Error("Проект не найден");
  const supabase = getSupabaseBrowserClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("ai_projects")
    .insert({
      user_id: userId,
      name: `${source.name} (копия)`,
      description: source.description ?? null,
      dataset_id: source.datasetId,
      model: source.model,
      filters_config: source.filtersConfig,
      filter_values: source.filterValues,
      prompt: source.prompt ?? null,
      builder_config: source.builderConfig ?? null,
      // Копируем выбор конфиденциальных столбцов; словарь замен новый проект
      // соберёт заново при первом запуске (привязан к своему project_id).
      confidential_columns: source.confidentialColumns ?? [],
      include_funnel: source.includeFunnel,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select()
    .single();
  if (error || !data)
    throw wrapError(
      "Не удалось дублировать проект",
      error?.message ?? "нет данных",
    );
  return rowToProject(data as AIProjectRow, 0);
}

export async function getAiProjectRuns(
  projectId: string,
  limit = 30,
): Promise<AIProjectRun[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("ai_project_runs")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw wrapError("Не удалось загрузить запуски", error.message);
  return ((data as AIProjectRunRow[] | null) ?? []).map(rowToProjectRun);
}

export async function createAiProjectRun(
  projectId: string,
  userId: string,
  data: {
    prompt: string;
    response: string;
    cost: number;
    model: AIModelId;
    inputTokens: number;
    outputTokens: number;
    filtersSnapshot: FilterCondition[];
  },
): Promise<AIProjectRun> {
  const supabase = getSupabaseBrowserClient();
  const { data: row, error } = await supabase
    .from("ai_project_runs")
    .insert({
      project_id: projectId,
      user_id: userId,
      prompt: data.prompt,
      response: data.response,
      cost: data.cost,
      model: data.model,
      input_tokens: data.inputTokens,
      output_tokens: data.outputTokens,
      filters_snapshot: data.filtersSnapshot,
    })
    .select()
    .single();
  if (error || !row)
    throw wrapError(
      "Не удалось сохранить запуск",
      error?.message ?? "нет данных",
    );

  // Удаляем старые запуски сверх 30 последних (keep latest 30 per project).
  const { data: old } = await supabase
    .from("ai_project_runs")
    .select("id, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .range(30, 1000);
  const toDelete = ((old as { id: string }[] | null) ?? []).map((r) => r.id);
  if (toDelete.length > 0) {
    await supabase.from("ai_project_runs").delete().in("id", toDelete);
  }
  return rowToProjectRun(row as AIProjectRunRow);
}

export async function deleteAiProjectRun(id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("ai_project_runs").delete().eq("id", id);
  if (error) throw wrapError("Не удалось удалить запуск", error.message);
}

export async function upsertUserSettings(
  userId: string,
  settings: Partial<UserSettings>,
): Promise<UserSettings> {
  const supabase = getSupabaseBrowserClient();
  const payload: Record<string, unknown> = {
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  if (settings.theme !== undefined) payload.theme = settings.theme;
  // Ключи провайдеров сохраняются ТОЛЬКО через серверный route (шифрование),
  // здесь — только тема и прочие нечувствительные настройки.
  const { data, error } = await supabase
    .from("user_settings")
    .upsert(payload, { onConflict: "user_id" })
    .select()
    .single();
  if (error || !data)
    throw wrapError(
      "Не удалось сохранить настройки",
      error?.message ?? "нет данных",
    );
  return rowToSettings(data as UserSettingsRow);
}

// ---------------------------------------------------------------------------
// План-проекты (миграция 021). Общая команда: RLS пускает любого вошедшего,
// поэтому фильтра по user_id нет.
// ---------------------------------------------------------------------------

interface PlanProjectRow {
  id: string;
  name: string;
  dataset_id: string;
  date_column: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface PlanFieldRow {
  id: string;
  project_id: string;
  label: string;
  source_column: string;
  kind: string;
  direction: string;
  format: string | null;
  sort_order: number | null;
}

interface PlanValueRow {
  field_id: string;
  month: string;
  value: number | string | null;
}

function rowToPlanField(row: PlanFieldRow): PlanField {
  return {
    id: row.id,
    projectId: row.project_id,
    label: row.label,
    sourceColumn: row.source_column,
    kind: isOneOf(PLAN_KINDS, row.kind) ? row.kind : "volume",
    direction: isOneOf(PLAN_DIRECTIONS, row.direction) ? row.direction : "higher",
    format: isOneOf(CALCULATED_FIELD_FORMATS, row.format) ? row.format : undefined,
    sortOrder: row.sort_order ?? 0,
  };
}

function rowToPlanProject(
  row: PlanProjectRow,
  fields: PlanField[] = [],
  values: PlanProject["values"] = {},
): PlanProject {
  return {
    id: row.id,
    name: row.name,
    datasetId: row.dataset_id,
    dateColumn: row.date_column,
    fields,
    values,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** `YYYY-MM` → дата 1-го числа для колонки `plan_values.month`. */
function planMonthToDate(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`Месяц плана должен быть в формате ГГГГ-ММ, пришло «${month}»`);
  }
  return `${month}-01`;
}

/** Все план-проекты с полями и значениями. */
export async function getPlanProjects(
  client?: SupabaseClient,
): Promise<PlanProject[]> {
  const supabase = client ?? getSupabaseBrowserClient();
  const { data: pRows, error: pErr } = await supabase
    .from("plan_projects")
    .select("*")
    .order("created_at", { ascending: true });
  if (pErr) throw wrapError("Не удалось загрузить план-проекты", pErr.message);
  const projects = (pRows as PlanProjectRow[] | null) ?? [];
  if (projects.length === 0) return [];

  const projectIds = projects.map((p) => p.id);
  const { data: fRows, error: fErr } = await supabase
    .from("plan_fields")
    .select("*")
    .in("project_id", projectIds)
    .order("sort_order", { ascending: true });
  if (fErr) throw wrapError("Не удалось загрузить поля плана", fErr.message);
  const fields = ((fRows as PlanFieldRow[] | null) ?? []).map(rowToPlanField);

  let valueRows: PlanValueRow[] = [];
  if (fields.length > 0) {
    const { data: vRows, error: vErr } = await supabase
      .from("plan_values")
      .select("field_id, month, value")
      .in(
        "field_id",
        fields.map((f) => f.id),
      );
    if (vErr) throw wrapError("Не удалось загрузить значения плана", vErr.message);
    valueRows = (vRows as PlanValueRow[] | null) ?? [];
  }

  const valuesByField: PlanProject["values"] = {};
  for (const v of valueRows) {
    const num = Number(v.value);
    if (v.value === null || !Number.isFinite(num)) continue;
    const month = String(v.month).slice(0, 7);
    (valuesByField[v.field_id] ??= {})[month] = num;
  }

  return projects.map((p) => {
    const own = fields.filter((f) => f.projectId === p.id);
    const values: PlanProject["values"] = {};
    for (const f of own) if (valuesByField[f.id]) values[f.id] = valuesByField[f.id];
    return rowToPlanProject(p, own, values);
  });
}

/**
 * Один план-проект с полями и значениями по id; `null` — нет такого.
 * Для сервера (сводка плана читает через service role только нужный проект).
 */
export async function getPlanProject(
  id: string,
  client?: SupabaseClient,
): Promise<PlanProject | null> {
  const supabase = client ?? getSupabaseBrowserClient();
  const { data: pRow, error: pErr } = await supabase
    .from("plan_projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (pErr) throw wrapError("Не удалось загрузить план-проект", pErr.message);
  if (!pRow) return null;

  const { data: fRows, error: fErr } = await supabase
    .from("plan_fields")
    .select("*")
    .eq("project_id", id)
    .order("sort_order", { ascending: true });
  if (fErr) throw wrapError("Не удалось загрузить поля плана", fErr.message);
  const fields = ((fRows as PlanFieldRow[] | null) ?? []).map(rowToPlanField);

  const values: PlanProject["values"] = {};
  if (fields.length > 0) {
    const { data: vRows, error: vErr } = await supabase
      .from("plan_values")
      .select("field_id, month, value")
      .in(
        "field_id",
        fields.map((f) => f.id),
      );
    if (vErr) throw wrapError("Не удалось загрузить значения плана", vErr.message);
    for (const v of (vRows as PlanValueRow[] | null) ?? []) {
      const num = Number(v.value);
      if (v.value === null || !Number.isFinite(num)) continue;
      (values[v.field_id] ??= {})[String(v.month).slice(0, 7)] = num;
    }
  }
  return rowToPlanProject(pRow as PlanProjectRow, fields, values);
}

export async function createPlanProject(data: {
  name: string;
  datasetId: string;
  dateColumn: string;
}): Promise<PlanProject> {
  const supabase = getSupabaseBrowserClient();
  const { data: row, error } = await supabase
    .from("plan_projects")
    .insert({
      name: data.name,
      dataset_id: data.datasetId,
      date_column: data.dateColumn,
    })
    .select()
    .single();
  if (error || !row)
    throw wrapError("Не удалось создать план-проект", error?.message ?? "нет данных");
  return rowToPlanProject(row as PlanProjectRow);
}

/** Обновляет шапку проекта (имя, датасет, колонку даты). Поля и значения не трогает. */
export async function updatePlanProject(
  id: string,
  updates: Partial<Pick<PlanProject, "name" | "datasetId" | "dateColumn">>,
): Promise<PlanProject> {
  const supabase = getSupabaseBrowserClient();
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.datasetId !== undefined) payload.dataset_id = updates.datasetId;
  if (updates.dateColumn !== undefined) payload.date_column = updates.dateColumn;
  const { data, error } = await supabase
    .from("plan_projects")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error || !data)
    throw wrapError("Не удалось обновить план-проект", error?.message ?? "нет данных");
  return rowToPlanProject(data as PlanProjectRow);
}

export async function deletePlanProject(id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("plan_projects").delete().eq("id", id);
  if (error) throw wrapError("Не удалось удалить план-проект", error.message);
}

/** Создаёт поле плана (нет `id`) или обновляет существующее. */
export async function upsertPlanField(
  projectId: string,
  field: Omit<PlanField, "id" | "projectId"> & { id?: string },
): Promise<PlanField> {
  const supabase = getSupabaseBrowserClient();
  const payload = {
    project_id: projectId,
    label: field.label,
    source_column: field.sourceColumn,
    kind: field.kind,
    direction: field.direction,
    format: field.format ?? null,
    sort_order: field.sortOrder,
  };
  const query = field.id
    ? supabase.from("plan_fields").update(payload).eq("id", field.id)
    : supabase.from("plan_fields").insert(payload);
  const { data, error } = await query.select().single();
  if (error || !data)
    throw wrapError("Не удалось сохранить поле плана", error?.message ?? "нет данных");
  return rowToPlanField(data as PlanFieldRow);
}

export async function deletePlanField(id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("plan_fields").delete().eq("id", id);
  if (error) throw wrapError("Не удалось удалить поле плана", error.message);
}

/** Плановое значение поля на месяц `YYYY-MM`; `null` удаляет значение («плана нет»). */
export async function setPlanValue(
  fieldId: string,
  month: string,
  value: number | null,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const monthDate = planMonthToDate(month);
  if (value === null) {
    const { error } = await supabase
      .from("plan_values")
      .delete()
      .eq("field_id", fieldId)
      .eq("month", monthDate);
    if (error) throw wrapError("Не удалось удалить значение плана", error.message);
    return;
  }
  const { error } = await supabase
    .from("plan_values")
    .upsert(
      { field_id: fieldId, month: monthDate, value },
      { onConflict: "field_id,month" },
    );
  if (error) throw wrapError("Не удалось сохранить значение плана", error.message);
}
