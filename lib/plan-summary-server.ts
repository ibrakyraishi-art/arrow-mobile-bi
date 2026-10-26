import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { friendlyClickhouseError } from "@/lib/data-source-server";
import { DEMO_DATASET_ID, buildDemoDataset } from "@/lib/demo-data";
import { executeQuery, type QueryBody } from "@/lib/query-engine-server";
import { planFactValue, toNum as num } from "@/lib/query-engine";
import { valueKey } from "@/lib/aggregation";
import {
  addMonths,
  completionColumnLight,
  daysInMonth,
  fillPlanColumns,
  monthBounds,
  moscowDate,
  moscowMonth,
  normalizeDate,
  planColumnName,
  type PlanSummaryField,
  type PlanSummaryResponse,
} from "@/lib/plan";
import type {
  CalculatedField,
  FilterCondition,
  PivotValueConfig,
  PlanField,
  PlanProject,
  PlanVirtualKind,
  QueryResultRow,
} from "@/lib/types";

/**
 * Сводка план-проекта за месяц (Решения §8) — серверная часть без HTTP:
 * откуда брать факт и подсчёт итогов/дней общим движком. Обработчик
 * `GET /api/plan/[id]/summary` только проверяет вход, читает проект и
 * отдаёт результат.
 */

/** Откуда считать факт: источник, таблица/SQL и вычисляемые поля датасета. */
export interface FactSource {
  dataSourceId: string;
  datasetId: string;
  table: string | null;
  sqlQuery: string | null;
  calculatedFields: CalculatedField[];
}

/** Источник факта плана или текст ошибки для UI («источник недоступен»). */
export type FactSourceResult =
  | { source: FactSource; error?: undefined }
  | { source: null; error: string };

/**
 * Источник факта план-проекта. Демо-датасет (`DEMO_DATASET_ID`) в БД не
 * хранится — факт берётся из демо-данных, как у демо-проекта. Остальные
 * датасеты читаются из БД через service role (карточки плана видны всей
 * команде, даже если датасет чужой).
 */
export async function planFactSource(
  project: Pick<PlanProject, "datasetId">,
  service: SupabaseClient,
  now: Date,
): Promise<FactSourceResult> {
  if (project.datasetId === DEMO_DATASET_ID) return { source: demoFactSource(now) };
  const { data: ds, error: dsErr } = await service
    .from("datasets")
    .select("data_source_id, table_name, sql_query, calculated_fields")
    .eq("id", project.datasetId)
    .maybeSingle();
  if (dsErr || !ds) {
    return { source: null, error: "Датасет плана не найден или недоступен" };
  }
  return {
    source: {
      dataSourceId: ds.data_source_id as string,
      datasetId: project.datasetId,
      table: (ds.table_name as string | null) ?? null,
      sqlQuery: (ds.sql_query as string | null) ?? null,
      calculatedFields: Array.isArray(ds.calculated_fields)
        ? (ds.calculated_fields as CalculatedField[])
        : [],
    },
  };
}

/** Источник факта демо-датасета (таблица installs_daily и её вычисляемые поля). */
export function demoFactSource(now: Date): FactSource {
  const demo = buildDemoDataset(now);
  return {
    dataSourceId: demo.dataSourceId,
    datasetId: demo.id,
    table: demo.table,
    sqlQuery: demo.sqlQuery,
    calculatedFields: demo.calculatedFields ?? [],
  };
}

export interface PlanSummaryDeps {
  /** Supabase для файловых источников и кредов ClickHouse (демо он не нужен). */
  supabase: () => SupabaseClient;
  now: Date;
}

/**
 * Итог по полям плана и по дням за месяц `month` (YYYY-MM). `source: null` —
 * поля с пустыми значениями и `sourceError` в ответе.
 */
export async function buildPlanSummary(
  project: PlanProject,
  month: string,
  factSource: FactSourceResult,
  deps: PlanSummaryDeps,
): Promise<PlanSummaryResponse> {
  const now = deps.now;
  // --- Календарь месяца ------------------------------------------------------
  const today = moscowDate(now);
  const currentMonth = moscowMonth(now);
  const dim = daysInMonth(month);
  const daysElapsed =
    month < currentMonth ? dim : month > currentMonth ? 0 : Number(today.slice(8, 10));
  const bounds = monthBounds(month);
  const fields = [...project.fields].sort((a, b) => a.sortOrder - b.sortOrder);

  const empty = (f: PlanField): PlanSummaryField => ({
    fieldId: f.id,
    label: f.label,
    kind: f.kind,
    direction: f.direction,
    format: f.format,
    plan: project.values[f.id]?.[month] ?? null,
    planToDate: null,
    fact: null,
    completion: null,
    forecast: null,
    deviation: null,
    light: null,
    daily: [],
  });
  const respond = (out: PlanSummaryField[], error?: string): PlanSummaryResponse => ({
    projectId: project.id,
    month,
    today,
    daysInMonth: dim,
    daysElapsed,
    fields: out,
    ...(error ? { error } : {}),
  });

  if (fields.length === 0) return respond([]);
  if (!factSource.source) return respond(fields.map(empty), factSource.error);
  const src = factSource.source;

  // --- Запросы через общий движок -------------------------------------------
  const calcNames = new Set(src.calculatedFields.map((c) => c.name));
  const factOf = (f: PlanField) => planFactValue(f, calcNames);
  const virt = (f: PlanField, k: PlanVirtualKind): PivotValueConfig => ({
    column: planColumnName(f.label, k),
    aggregation: "SUM",
  });
  // Период — весь месяц; верхняя граница «< 1-е число следующего месяца»,
  // чтобы дата-время последнего дня тоже попадало.
  const filters: FilterCondition[] = [
    { id: "plan-from", column: project.dateColumn, operator: ">=", value: bounds.from },
    {
      id: "plan-to",
      column: project.dateColumn,
      operator: "<",
      value: `${addMonths(month, 1)}-01`,
    },
  ];
  const planCtx = {
    dateColumn: project.dateColumn,
    fields: project.fields,
    values: project.values,
  };
  const baseBody = (rows: string[], values: PivotValueConfig[]): QueryBody => ({
    dataSourceId: src.dataSourceId,
    datasetId: src.datasetId,
    table: src.table,
    sqlQuery: src.sqlQuery,
    chartType: "pivot",
    config: { rows, columns: [], values, filters },
    calculatedFields: src.calculatedFields,
    plan: planCtx,
    limit: 5000,
  });
  const queryDeps = { supabase: deps.supabase, today: now };

  const totalValues = fields.flatMap((f) => [
    factOf(f),
    virt(f, "plan"),
    virt(f, "planToDate"),
    virt(f, "completion"),
    virt(f, "forecast"),
    virt(f, "deviation"),
  ]);
  const dailyValues = fields.flatMap((f) => [factOf(f), virt(f, "plan")]);

  let totals: QueryResultRow | null = null;
  let dailyRows: QueryResultRow[] = [];
  try {
    const [t, d] = await Promise.all([
      executeQuery(baseBody([], totalValues), queryDeps),
      executeQuery(baseBody([project.dateColumn], dailyValues), queryDeps),
    ]);
    const err = t.body.error ?? d.body.error;
    if (err) return respond(fields.map(empty), err);
    totals = t.body.data?.[0] ?? null;
    dailyRows = d.body.data ?? [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return respond(fields.map(empty), friendlyClickhouseError(msg));
  }

  // Дни без данных: факт пуст, «· план» — дневной план (рисуется линия плана).
  const byDate = new Map<string, QueryResultRow>();
  for (const r of dailyRows) {
    const d = normalizeDate(r[project.dateColumn]);
    if (d) byDate.set(d, r);
  }
  const allDays: string[] = [];
  for (let i = 1; i <= dim; i++) allDays.push(`${month}-${String(i).padStart(2, "0")}`);
  const missing = allDays.filter((d) => !byDate.has(d));
  const missingPlan = new Map<string, QueryResultRow>();
  if (missing.length > 0) {
    const filled = fillPlanColumns(
      missing.map((d) => ({ row: {}, facts: {}, dates: [d], groupedByDate: true })),
      planCtx,
      now,
    );
    missing.forEach((d, i) => missingPlan.set(d, filled[i]));
  }

  const out: PlanSummaryField[] = fields.map((f) => {
    const get = (k: PlanVirtualKind) => num(totals?.[valueKey(virt(f, k))]);
    const pct = get("completion");
    const daily = allDays.map((date) => {
      const row = byDate.get(date);
      if (row) {
        return {
          date,
          fact: num(row[valueKey(factOf(f))]),
          plan: num(row[valueKey(virt(f, "plan"))]),
        };
      }
      return {
        date,
        fact: null,
        plan: num(missingPlan.get(date)?.[planColumnName(f.label, "plan")]),
      };
    });
    if (!totals) return { ...empty(f), daily };
    return {
      fieldId: f.id,
      label: f.label,
      kind: f.kind,
      direction: f.direction,
      format: f.format,
      plan: get("plan"),
      planToDate: get("planToDate"),
      fact: num(totals[valueKey(factOf(f))]),
      completion: pct === null ? null : pct / 100,
      forecast: get("forecast"),
      deviation: get("deviation"),
      light: completionColumnLight(pct, f.direction),
      daily,
    };
  });
  return respond(out);
}
