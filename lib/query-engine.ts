/**
 * Общий движок запросов — чистая часть без I/O. Им считают `/api/query`
 * и `/api/plan/[id]/summary` (серверная обвязка — `lib/query-engine-server.ts`).
 *
 * Что делает:
 *  - раскладывает конфиг визуализации на группировку и значения;
 *  - готовит вычисляемые поля (dataset + viz, топосортировка, aggregate-level);
 *  - поля плана (Решения §6): виртуальные колонки `«<подпись> · план»` и т.д.
 *    убираются из агрегации, исходные метрики полей плана добавляются, даты
 *    групп собираются (in-JS — из строк, ClickHouse — вторичным запросом),
 *    затем колонки дозаполняет `fillPlanColumns` из модуля `plan`;
 *  - in-JS исполнение (демо и файловые источники) и сборка SQL для ClickHouse.
 *
 * Импорты относительные: модуль компилируется в тест
 * `scripts/test-query-engine.cjs` без алиасов `@/`.
 */
import {
  aggregate,
  applyFilters,
  comboValues,
  groupKey,
  valueKey,
  type AggregateCalcField,
} from "./aggregation";
import {
  computeAggregateFlags,
  enrichRowsWithCalculated,
  formulaToSql,
  liftRowLevelToAggregate,
  prepareCalculatedFields,
  resolveCalcRefs,
  topoSortCalculatedFields,
  type PreparedField,
} from "./formula";
import { escapeSql, quoteIdent } from "./clickhouse";
import {
  clampRowLimit,
  containsDangerousSQL,
  validateColumnName,
  validateTableName,
} from "./sql-validator";
import { fillPlanColumns, normalizeDate, resolvePlanColumn } from "./plan";
import type { PlanGroup } from "./plan";
import type {
  AggregationType,
  CalculatedField,
  FilterCondition,
  PivotValueConfig,
  PlanContext,
  PlanField,
  QueryResultRow,
  VisualizationConfig,
  VisualizationType,
} from "./types";

/** Тело запроса `/api/query`. */
export interface QueryBody {
  dataSourceId: string;
  datasetId: string;
  table: string | null;
  sqlQuery: string | null;
  // Поле остаётся для обратной совместимости со старыми клиентами, но
  // для боевых источников креды всегда берутся из Supabase по
  // dataSourceId — body.source игнорируется (кроме флага isDemo).
  source?: {
    id?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    ssl?: boolean;
    isDemo?: boolean;
  };
  chartType?: VisualizationType;
  config?: VisualizationConfig;
  limit?: number;
  /** Вычисляемые поля датасета (постоянные). */
  calculatedFields?: CalculatedField[];
  /**
   * Вычисляемые поля визуализации (временные, живут только внутри
   * одной визуализации). Применяются ПОСЛЕ dataset-полей и могут
   * на них ссылаться. Сессия 27.
   */
  vizCalculatedFields?: CalculatedField[];
  /**
   * План-проект датасета: если в значениях есть виртуальные колонки плана
   * (`«<подпись> · план»` и т.д.), сервер считает их сам. Без `plan` —
   * поведение прежнее.
   */
  plan?: PlanContext;
}

/** Поля плана в запросе. `null`, если виртуальных колонок в значениях нет. */
export interface PlanQuery {
  /** Контекст только с полями, на которые ссылаются виртуальные колонки. */
  ctx: PlanContext;
  /** Виртуальные значения ровно как пришли в конфиге. */
  virtual: PivotValueConfig[];
  /** Факт каждого поля плана — какое значение агрегата им служит. */
  facts: { field: PlanField; value: PivotValueConfig }[];
  /** Ключи фактов, которые добавил движок (в ответ не попадают). */
  addedKeys: string[];
  /** Группировка идёт по колонке даты плана → дневной план. */
  groupedByDate: boolean;
}

export interface PreparedQuery {
  chartType: VisualizationType;
  config: VisualizationConfig;
  groupBy: string[];
  /** Значения, которые реально агрегирует движок (без виртуальных, с фактами плана). */
  values: PivotValueConfig[];
  rowLevelOrdered: PreparedField[];
  aggCalcResolved: AggregateCalcField[];
  preparedMap: Map<string, PreparedField>;
  aggCalcNames: Set<string>;
  plan: PlanQuery | null;
}

/** Имя колонки даты во вторичном запросе дат ClickHouse. */
export const PLAN_DATE_KEY = "__plan_date";

export function buildGroupBy(
  chartType: VisualizationType,
  config: VisualizationConfig,
): string[] {
  if (chartType === "pivot") {
    return Array.from(
      new Set([...(config.rows ?? []), ...(config.columns ?? [])]),
    );
  }
  // Прогресс: необязательный разрез — rows[0]; без него одна строка-итог.
  if (chartType === "progress") {
    return config.rows?.[0] ? [config.rows[0]] : [];
  }
  // chart
  const out: string[] = [];
  if (config.xAxis) out.push(config.xAxis);
  // Pie can't render multiple series — including one here would produce
  // duplicated slices with the same name. Only bar/line/area support series.
  // Комбо рисует несколько значений по X — серии у него нет.
  if (config.series && chartType !== "pie" && chartType !== "combo") {
    out.push(config.series);
  }
  return out;
}

export function buildValues(
  chartType: VisualizationType,
  config: VisualizationConfig,
): PivotValueConfig[] {
  if (chartType === "pivot") return config.values ?? [];
  // Комбо: values[0] — столбцы, values[1..] — линии; прогресс — поля выполнения.
  if (chartType === "combo") return comboValues(config);
  if (chartType === "progress") return config.values ?? [];
  if (config.yAxis) return [config.yAxis];
  return [];
}

/**
 * Значение-факт поля плана: вычисляемое поле считается по своей формуле
 * (агрегация не важна), «объём» — SUM, сырая колонка-«ставка» — AVG.
 */
export function planFactValue(
  field: Pick<PlanField, "sourceColumn" | "kind">,
  calculatedNames: Set<string>,
): PivotValueConfig {
  const aggregation: AggregationType =
    field.kind === "rate" && !calculatedNames.has(field.sourceColumn) ? "AVG" : "SUM";
  return { column: field.sourceColumn, aggregation };
}

function planQueryOf(
  planCtx: PlanContext | undefined,
  requested: PivotValueConfig[],
  groupBy: string[],
  calculatedNames: Set<string>,
): { plan: PlanQuery; values: PivotValueConfig[] } | null {
  if (!planCtx || !Array.isArray(planCtx.fields) || planCtx.fields.length === 0) {
    return null;
  }
  const used = new Map<string, PlanField>();
  const virtual: PivotValueConfig[] = [];
  const kept: PivotValueConfig[] = [];
  for (const v of requested) {
    const hit = resolvePlanColumn(v.column, planCtx.fields);
    if (hit) {
      virtual.push(v);
      used.set(hit.field.id, hit.field);
    } else {
      kept.push(v);
    }
  }
  if (virtual.length === 0) return null;

  const keptKeys = new Set(kept.map(valueKey));
  const added: PivotValueConfig[] = [];
  const facts: PlanQuery["facts"] = [];
  for (const field of Array.from(used.values())) {
    const value = planFactValue(field, calculatedNames);
    const key = valueKey(value);
    if (!keptKeys.has(key) && !added.some((a) => valueKey(a) === key)) {
      added.push(value);
    }
    facts.push({ field, value });
  }
  return {
    plan: {
      ctx: {
        dateColumn: planCtx.dateColumn,
        fields: Array.from(used.values()),
        values: planCtx.values ?? {},
      },
      virtual,
      facts,
      addedKeys: added.map(valueKey),
      groupedByDate: groupBy.includes(planCtx.dateColumn),
    },
    values: [...kept, ...added],
  };
}

/** Разбирает тело запроса: группировка, значения, вычисляемые поля, поля плана. */
export function prepareQuery(body: QueryBody): PreparedQuery {
  const chartType: VisualizationType = body.chartType ?? "pivot";
  const config: VisualizationConfig = body.config ?? {
    rows: [],
    columns: [],
    values: [],
    filters: [],
  };

  // Build groupBy & values according to chart type
  const groupBy = buildGroupBy(chartType, config);
  const requested = buildValues(chartType, config);

  // Подготавливаем вычисляемые поля: парсим формулы, отбрасываем
  // невалидные (валидация делается отдельно в редакторе). Сначала —
  // dataset-поля, затем — viz-поля. Топосортируем результат, чтобы
  // ссылки [arpu] → [arpu_x100] резолвились корректно.
  const preparedDataset = prepareCalculatedFields(body.calculatedFields ?? []);
  const preparedViz = prepareCalculatedFields(body.vizCalculatedFields ?? []);
  // Если viz-поле и dataset-поле имеют одинаковое имя — побеждает viz.
  const mergedByName = new Map<string, PreparedField>();
  for (const p of preparedDataset) mergedByName.set(p.field.name, p);
  for (const p of preparedViz) mergedByName.set(p.field.name, p);
  const allPrepared = Array.from(mergedByName.values());
  const ordered = topoSortCalculatedFields(allPrepared);
  const preparedMap = new Map(ordered.map((p) => [p.field.name, p]));
  // Aggregate-level поля: формула содержит SUM/AVG/COUNT/MIN/MAX напрямую
  // ИЛИ (транзитивно) ссылается на aggregate-поле.
  const aggFlags = computeAggregateFlags(allPrepared);
  const aggCalcNames = new Set<string>();
  for (const [name, isAgg] of Array.from(aggFlags)) if (isAgg) aggCalcNames.add(name);
  const rowLevelOrdered = ordered.filter((p) => !aggCalcNames.has(p.field.name));
  const aggOrdered = ordered.filter((p) => aggCalcNames.has(p.field.name));

  // Поля плана: виртуальные колонки уходят из агрегации, факты — добавляются.
  const planned = planQueryOf(
    body.plan,
    requested,
    groupBy,
    new Set(preparedMap.keys()),
  );
  const values = planned ? planned.values : requested;

  // Вычисляемые поля, выбранные как МЕТРИКИ, считаются ПО ФОРМУЛЕ (без внешней
  // агрегации): aggregate-level — как есть; row-level «поднимаем» до агрегата
  // (SUM по базам → доля считается из сумм по группе, как в сводных). Считаем
  // один раз — не зависит от данных, нужно и demo-, и файловой ветке.
  const metricColumns = new Set(values.map((v) => v.column));
  const aggCalcResolved: AggregateCalcField[] = [
    ...aggOrdered.map((p) => ({
      name: p.field.name,
      datasetType: p.field.datasetType,
      ast: resolveCalcRefs(p.ast, preparedMap),
    })),
    ...rowLevelOrdered
      .filter((p) => metricColumns.has(p.field.name))
      .map((p) => ({
        name: p.field.name,
        datasetType: p.field.datasetType,
        ast: liftRowLevelToAggregate(resolveCalcRefs(p.ast, preparedMap)),
      })),
  ];

  return {
    chartType,
    config,
    groupBy,
    values,
    rowLevelOrdered,
    aggCalcResolved,
    preparedMap,
    aggCalcNames,
    plan: planned ? planned.plan : null,
  };
}

/** Число из ячейки результата (ClickHouse отдаёт 64-битные целые строками); иначе `null`. */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Даты по группам из сырых строк (in-JS). */
export function datesByGroupFromRows(
  rows: QueryResultRow[],
  groupBy: string[],
  dateColumn: string,
): Map<string, string[]> {
  const sets = new Map<string, Set<string>>();
  for (const row of rows) {
    const d = normalizeDate(row[dateColumn]);
    if (!d) continue;
    const key = groupKey(row, groupBy);
    let set = sets.get(key);
    if (!set) {
      set = new Set();
      sets.set(key, set);
    }
    set.add(d);
  }
  const out = new Map<string, string[]>();
  for (const [k, s] of Array.from(sets)) out.set(k, Array.from(s));
  return out;
}

/**
 * Дозаполняет агрегированные строки колонками плана под ключами значений
 * (`valueKey`, например `SUM(Расход · план)`), убирает добавленные движком факты.
 * `datesByKey` — даты групп; `null` — группировка по дате, дата берётся из строки.
 */
export function attachPlanColumns(
  rows: QueryResultRow[],
  datesByKey: Map<string, string[]> | null,
  q: PreparedQuery,
  today: Date,
  /** Факт «объёмов» по дням на группу (`planFactsByDate*`) — выполнение только по датам с планом. */
  factsByKey?: Map<string, Record<string, Record<string, number | null>>> | null,
): QueryResultRow[] {
  const p = q.plan;
  if (!p) return rows;
  const groups: PlanGroup[] = rows.map((row) => {
    const facts: Record<string, number | null> = {};
    for (const { field, value } of p.facts) {
      facts[field.sourceColumn] = toNum(row[valueKey(value)]);
    }
    let dates: string[];
    if (datesByKey) {
      dates = datesByKey.get(groupKey(row, q.groupBy)) ?? [];
    } else {
      const d = normalizeDate(row[p.ctx.dateColumn]);
      dates = d ? [d] : [];
    }
    // Факт по дням передан, но этой группы в нём нет → `null` (явно «неизвестно»),
    // а не факт группы целиком за все месяцы.
    const factsByDate = factsByKey ? (factsByKey.get(groupKey(row, q.groupBy)) ?? null) : undefined;
    return {
      row,
      facts,
      dates,
      groupedByDate: p.groupedByDate,
      ...(factsByDate !== undefined ? { factsByDate } : {}),
    };
  });
  const filled = fillPlanColumns(groups, p.ctx, today);
  return filled.map((f, i) => {
    const out: QueryResultRow = { ...rows[i] };
    for (const v of p.virtual) {
      const val = f[v.column];
      out[valueKey(v)] = val === undefined ? null : val;
    }
    for (const k of p.addedKeys) delete out[k];
    return out;
  });
}

/**
 * Факты полей-«объёмов» плана. При группировке по дате не нужны: в группе
 * одна дата, и у месяца без плана выполнение и так пустое.
 */
function planVolumeFacts(q: PreparedQuery): PlanQuery["facts"] {
  if (!q.plan || q.plan.groupedByDate) return [];
  return q.plan.facts.filter((f) => f.field.kind === "volume");
}

/**
 * Факт «объёмов» по дням на группу из строк, сгруппированных по измерениям
 * и дате (in-JS — агрегат по `[...groupBy, date]`, ClickHouse — вторичный
 * запрос дат): `groupKey → { день → { sourceColumn → факт } }`.
 */
export function planFactsByDateFromRows(
  rows: QueryResultRow[],
  q: PreparedQuery,
  dateKey: string,
): Map<string, Record<string, Record<string, number | null>>> | null {
  const volumeFacts = planVolumeFacts(q);
  if (volumeFacts.length === 0) return null;
  const out = new Map<string, Record<string, Record<string, number | null>>>();
  for (const row of rows) {
    const d = normalizeDate(row[dateKey]);
    if (!d) continue;
    const key = groupKey(row, q.groupBy);
    let byDate = out.get(key);
    if (!byDate) {
      byDate = {};
      out.set(key, byDate);
    }
    const day = (byDate[d] ??= {});
    for (const { field, value } of volumeFacts) {
      const v = toNum(row[valueKey(value)]);
      if (v === null) continue;
      day[field.sourceColumn] = (day[field.sourceColumn] ?? 0) + v;
    }
  }
  return out;
}

/** Предел строк вторичного запроса дат ClickHouse. */
export const PLAN_DATES_LIMIT = 100000;

/** Пометка в ответе: запрос дат обрезан лимитом, выполнение объёмов не посчитано. */
export const PLAN_DATES_TRUNCATED_WARNING =
  "Слишком много групп и дней для полей плана: выполнение, прогноз и отклонение объёмов не посчитаны — сузьте период или разрез.";

/**
 * Факт «объёмов» по дням из ответа запроса дат ClickHouse. Ответ ровно в
 * `PLAN_DATES_LIMIT` строк считается обрезанным: факт по дням неполный, и
 * вместо заниженного выполнения объёмы получают `null` (пустая карта — ни
 * одной группы) и пометку `warning`.
 */
export function planDailyFactsFromDateRows(
  rows: QueryResultRow[],
  q: PreparedQuery,
): {
  factsByKey: Map<string, Record<string, Record<string, number | null>>> | null;
  warning?: string;
} {
  const factsByKey = planFactsByDateFromRows(rows, q, PLAN_DATE_KEY);
  if (factsByKey && rows.length >= PLAN_DATES_LIMIT) {
    return { factsByKey: new Map(), warning: PLAN_DATES_TRUNCATED_WARNING };
  }
  return { factsByKey };
}

/**
 * In-JS исполнение (демо и файловые источники): вычисляемые поля →
 * фильтры → агрегация → поля плана → лимит.
 */
export function runInJs(
  all: QueryResultRow[],
  q: PreparedQuery,
  limit: number | undefined,
  today: Date,
): QueryResultRow[] {
  const enriched =
    q.rowLevelOrdered.length > 0
      ? enrichRowsWithCalculated(all, q.rowLevelOrdered)
      : all;
  const filtered = applyFilters(enriched, q.config.filters);
  if (q.groupBy.length === 0 && q.values.length === 0) {
    return filtered.slice(0, clampRowLimit(limit, 500));
  }
  const agg = aggregate(filtered, q.groupBy, q.values, q.aggCalcResolved);
  let factsByKey: Map<string, Record<string, Record<string, number | null>>> | null = null;
  const volumeFacts = planVolumeFacts(q);
  if (q.plan && volumeFacts.length > 0) {
    // Факт «объёмов» по группе и дню — чтобы выполнение считалось только по
    // датам месяцев с планом (дефект Т07-4).
    const dateCol = q.plan.ctx.dateColumn;
    const byDay = aggregate(
      filtered,
      [...q.groupBy, dateCol],
      volumeFacts.map((f) => f.value),
      q.aggCalcResolved,
    );
    factsByKey = planFactsByDateFromRows(byDay, q, dateCol);
  }
  const out = q.plan
    ? attachPlanColumns(
        agg,
        datesByGroupFromRows(filtered, q.groupBy, q.plan.ctx.dateColumn),
        q,
        today,
        factsByKey,
      )
    : agg;
  return out.slice(0, clampRowLimit(limit, 5000));
}

/** Короткий путь для тестов и серверной обвязки: разобрать тело и посчитать in-JS. */
export function queryRows(
  all: QueryResultRow[],
  body: QueryBody,
  today: Date,
): QueryResultRow[] {
  return runInJs(all, prepareQuery(body), body.limit, today);
}

// ---------------------------------------------------------------------------
// ClickHouse: валидация имён и сборка SQL
// ---------------------------------------------------------------------------

/**
 * Проверка идентификаторов и кастомного SQL ПЕРЕД построением запроса:
 * здесь имена попадают в реальный SQL (через quoteIdent). `null` — всё ок.
 */
export function validateForSql(q: PreparedQuery, body: QueryBody): string | null {
  if (body.table && !validateTableName(body.table)) {
    return "Недопустимое имя таблицы";
  }
  for (const col of [...q.groupBy, ...q.values.map((v) => v.column)]) {
    if (!validateColumnName(col)) {
      return `Недопустимое имя столбца: ${col}`;
    }
  }
  if (q.plan && !validateColumnName(q.plan.ctx.dateColumn)) {
    return `Недопустимое имя столбца даты плана: ${q.plan.ctx.dateColumn}`;
  }
  for (const f of q.config.filters ?? []) {
    if (f.column && !validateColumnName(f.column)) {
      return `Недопустимое имя столбца в фильтре: ${f.column}`;
    }
  }
  if (body.sqlQuery && containsDangerousSQL(body.sqlQuery)) {
    return "Запрос содержит запрещённые операции (DROP/DELETE/INSERT/…)";
  }
  return null;
}

// SQL-режим: разворачиваем calc→calc ссылки в плоский AST с одними
// только сырыми идентификаторами столбцов (+ агрегатами) — см. resolveCalcRefs.
// Используется для groupBy / row-level value-выражений. Aggregate-calc
// в groupBy через UI попасть не может (calc-поля только в «Значениях»).
function columnExpr(q: PreparedQuery, col: string): string {
  const calc = q.preparedMap.get(col);
  if (!calc) return quoteIdent(col);
  return formulaToSql(resolveCalcRefs(calc.ast, q.preparedMap), quoteIdent);
}

/** Основной SQL запроса (как раньше в /api/query). */
export function buildMainSql(
  q: PreparedQuery,
  fromClause: string,
  limit: number | undefined,
): string {
  const rowLimit = clampRowLimit(limit, 500);
  const where = whereClause(q.config.filters);
  if (q.groupBy.length === 0 && q.values.length === 0) {
    // Плоская выборка без агрегации — aggregate-calc-поля тут не имеют
    // смысла (нет групп) и сломали бы SQL (`sum()` без GROUP BY) → пропускаем.
    const calcSelects = q.rowLevelOrdered.map(
      (p) =>
        `${formulaToSql(resolveCalcRefs(p.ast, q.preparedMap), quoteIdent)} AS ${quoteIdent(p.field.name)}`,
    );
    const selectClause =
      calcSelects.length > 0 ? `*, ${calcSelects.join(", ")}` : `*`;
    return `SELECT ${selectClause} FROM ${fromClause}${where} LIMIT ${rowLimit}`;
  }
  const valueSelects = q.values.map((v) => valueSelectSql(q, v));
  const selects = [
    ...q.groupBy.map((g) => `${columnExpr(q, g)} AS ${quoteIdent(g)}`),
    ...valueSelects,
  ].join(", ");
  const groupSql =
    q.groupBy.length > 0
      ? ` GROUP BY ${q.groupBy.map((g) => columnExpr(q, g)).join(", ")}`
      : "";
  return `SELECT ${selects} FROM ${fromClause}${where}${groupSql} LIMIT 10000`;
}

/** Выражение значения в SELECT: `sum(col) AS "SUM(col)"` или формула вычисляемого поля. */
function valueSelectSql(q: PreparedQuery, v: PivotValueConfig): string {
  const calc = q.preparedMap.get(v.column);
  if (calc) {
    // Вычисляемое поле считаем ПО ФОРМУЛЕ (без внешней агрегации):
    // aggregate-level — как есть; row-level поднимаем до агрегата
    // (SUM по базам → доля из сумм по группе, как в сводных).
    const resolved = resolveCalcRefs(calc.ast, q.preparedMap);
    const ast = q.aggCalcNames.has(v.column)
      ? resolved
      : liftRowLevelToAggregate(resolved);
    return `${formulaToSql(ast, quoteIdent)} AS ${quoteIdent(valueKey(v))}`;
  }
  return `${sqlAggregation(v, columnExpr(q, v.column))} AS ${quoteIdent(valueKey(v))}`;
}

/**
 * Вторичный запрос дат для полей плана: `SELECT dims, toDate(date), факт
 * объёмов … GROUP BY dims, toDate(date)` с теми же фильтрами. Нужен, только
 * если группировка не по дате (иначе дата есть в каждой строке). Факт
 * «объёмов» по дням — чтобы выполнение считалось только по датам с планом
 * (`planFactsByDateFromRows` с ключом `PLAN_DATE_KEY`). Имена уже проверены
 * `validateForSql`.
 */
export function buildPlanDatesSql(q: PreparedQuery, fromClause: string): string | null {
  if (!q.plan || q.plan.groupedByDate) return null;
  const dateExpr = `toDate(${columnExpr(q, q.plan.ctx.dateColumn)})`;
  const selects = [
    ...q.groupBy.map((g) => `${columnExpr(q, g)} AS ${quoteIdent(g)}`),
    `${dateExpr} AS ${quoteIdent(PLAN_DATE_KEY)}`,
    ...planVolumeFacts(q).map((f) => valueSelectSql(q, f.value)),
  ].join(", ");
  const groupSql = [...q.groupBy.map((g) => columnExpr(q, g)), dateExpr].join(", ");
  return `SELECT ${selects} FROM ${fromClause}${whereClause(q.config.filters)} GROUP BY ${groupSql} LIMIT ${PLAN_DATES_LIMIT}`;
}

/** Даты по группам из ответа вторичного запроса дат. */
export function datesByGroupFromDateRows(
  rows: QueryResultRow[],
  groupBy: string[],
): Map<string, string[]> {
  return datesByGroupFromRows(rows, groupBy, PLAN_DATE_KEY);
}

function sqlAggregation(v: PivotValueConfig, columnSql: string): string {
  switch (v.aggregation) {
    case "COUNT":
      return `count(${columnSql})`;
    case "SUM":
      return `sum(${columnSql})`;
    case "AVG":
      return `avg(${columnSql})`;
    case "MIN":
      return `min(${columnSql})`;
    case "MAX":
      return `max(${columnSql})`;
  }
}

function whereClause(filters?: FilterCondition[]): string {
  if (!filters || filters.length === 0) return "";
  const parts = filters
    .filter((f) => f.column && f.value !== "")
    .map((f) => {
      const col = quoteIdent(f.column);
      const raw = f.value;
      const asNumber = Number(raw);
      const isNumeric = !Number.isNaN(asNumber);
      const valExpr = isNumeric ? String(asNumber) : `'${escapeSql(raw)}'`;
      switch (f.operator) {
        case "=":
          return `${col} = ${valExpr}`;
        case "!=":
          return `${col} != ${valExpr}`;
        case ">":
          return `${col} > ${valExpr}`;
        case "<":
          return `${col} < ${valExpr}`;
        case ">=":
          return `${col} >= ${valExpr}`;
        case "<=":
          return `${col} <= ${valExpr}`;
        case "contains":
          return `positionCaseInsensitive(toString(${col}), '${escapeSql(raw)}') > 0`;
        case "in": {
          const list = parseInListSql(raw);
          if (list.length === 0) return null;
          const items = list
            .map((v) => {
              const n = Number(v);
              return !Number.isNaN(n) && v.trim() !== ""
                ? String(n)
                : `'${escapeSql(v)}'`;
            })
            .join(", ");
          return `${col} IN (${items})`;
        }
      }
    })
    .filter((p): p is string => Boolean(p));
  if (parts.length === 0) return "";
  return " WHERE " + parts.join(" AND ");
}

function parseInListSql(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v));
  } catch {
    // fall through to csv
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
