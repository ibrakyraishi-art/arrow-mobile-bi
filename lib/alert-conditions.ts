import "server-only";
import { escapeSql, quoteIdent } from "@/lib/clickhouse";
import {
  formulaToSql,
  stripAggregates,
  type FormulaNode,
} from "@/lib/formula";
import { valueKey } from "@/lib/aggregation";
import type {
  AggregationType,
  AlertCondition,
  AlertConditionOperator,
  AlertConditionPeriodChange,
  AlertConditionVsGroupAvg,
  AlertRule,
  FilterCondition,
  PivotValueConfig,
  QueryResultRow,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Value-фильтры (по значениям полей) → SQL WHERE. Применяются ДО агрегации.
// ---------------------------------------------------------------------------

/** Парсит значение `in`-фильтра: JSON-массив или CSV. */
function parseInListValues(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter(Boolean);
  } catch {
    // not json — fall through to csv
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Превращает value-фильтры в массив SQL-условий для WHERE (ClickHouse).
 * `colExpr` маппит имя поля → SQL-выражение (с учётом calc-полей).
 */
export function valueFiltersToSqlWhere(
  filters: FilterCondition[] | undefined,
  colExpr: (name: string) => string,
  /** Aggregate-calc поля нельзя класть в WHERE до агрегации — пропускаем. */
  isAggCalc: (name: string) => boolean = () => false,
): string[] {
  if (!filters || filters.length === 0) return [];
  const parts: string[] = [];
  for (const f of filters) {
    if (!f || !f.column) continue;
    if (isAggCalc(f.column)) continue;
    const col = colExpr(f.column);
    const v = f.value ?? "";
    switch (f.operator) {
      case "=":
      case "!=":
      case ">":
      case "<":
      case ">=":
      case "<=": {
        const num = Number(v);
        const isNum = v.trim() !== "" && !Number.isNaN(num);
        const rhs = isNum ? String(num) : `'${escapeSql(v)}'`;
        parts.push(`${col} ${f.operator} ${rhs}`);
        break;
      }
      case "contains":
        parts.push(
          `positionCaseInsensitive(toString(${col}), '${escapeSql(v)}') > 0`,
        );
        break;
      case "in": {
        const list = parseInListValues(v);
        if (list.length === 0) break;
        const quoted = list.map((x) => `'${escapeSql(x)}'`).join(", ");
        parts.push(`toString(${col}) IN (${quoted})`);
        break;
      }
    }
  }
  return parts;
}

/**
 * SQL-агрегат метрики за период (для display-метрик таблицы): SUM/AVG/MIN/MAX
 * → `<fn>If(expr, period)`; COUNT → `countIf(period)`. Без столбца даты —
 * обычный `<fn>(expr)` / `count()`. Экспортируется для переиспользования
 * в простом (не-advanced) пути alert-engine.
 */
export function metricAggSql(
  agg: AggregationType,
  expr: string,
  periodCond: string | null,
): string {
  if (agg === "COUNT") {
    return periodCond ? `countIf(${periodCond})` : `count()`;
  }
  const fn = agg.toLowerCase(); // sum | avg | min | max
  return periodCond ? `${fn}If(${expr}, ${periodCond})` : `${fn}(${expr})`;
}

// ---------------------------------------------------------------------------
// Расширенные типы условий alert-правил: period_change / vs_group_avg / trend.
// Поддерживают ratio-метрики (например CPA = sum(cost)/sum(installs) за период)
// через поле `metricDenominator`. (threshold обрабатывается «классическим»
// путём в alert-engine.ts.)
// ---------------------------------------------------------------------------

/** `trend` — сахар над `period_change`. Разворачиваем для единообразия. */
export function desugarConditions(conditions: AlertCondition[]): AlertCondition[] {
  return conditions.map((c): AlertCondition => {
    if (c.kind === "trend") {
      const base = {
        kind: "period_change" as const,
        metric: c.metric,
        ...(c.metricDenominator ? { metricDenominator: c.metricDenominator } : {}),
        periodA: c.periodA,
        periodB: c.periodB,
      };
      return c.direction === "worsening"
        ? { ...base, operator: ">=", value: c.minChangePercent }
        : { ...base, operator: "<=", value: -c.minChangePercent };
    }
    return c;
  });
}

export function isAdvancedCondition(
  c: AlertCondition,
): c is AlertConditionPeriodChange | AlertConditionVsGroupAvg {
  return c.kind === "period_change" || c.kind === "vs_group_avg";
}

export function hasAdvancedConditions(conditions: AlertCondition[]): boolean {
  return desugarConditions(conditions).some(isAdvancedCondition);
}

function sqlOp(op: AlertConditionOperator): string {
  return op;
}

/**
 * Разделитель, склеивающий значения нескольких колонок в один ключ группы.
 * Берём US (Unit Separator, ) — не встречается в реальных данных.
 */
const GROUP_KEY_SEP = "";

/** Безопасное имя плейсхолдера / алиаса: snake_case, только ASCII. */
function safeName(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "x"
  );
}

/** Базовое имя метрики условия (для имён колонок/плейсхолдеров). */
function metricBaseName(c: { metric: string; metricDenominator?: string }): string {
  return c.metricDenominator
    ? `${safeName(c.metric)}_per_${safeName(c.metricDenominator)}`
    : safeName(c.metric);
}

/** Имена плейсхолдеров для одного условия. */
export function placeholderNamesFor(c: AlertCondition): string[] {
  if (c.kind === "period_change" || c.kind === "trend") {
    const m = metricBaseName(c);
    const out = [`${m}_${c.periodA}d`, `${m}_${c.periodB}d`, `${m}_change_percent`];
    if (c.metricDenominator) {
      const n = safeName(c.metric);
      out.push(`${n}_${c.periodA}d`, `${n}_${c.periodB}d`);
    }
    return out;
  }
  if (c.kind === "vs_group_avg") {
    const m = metricBaseName(c);
    const g = c.groupBy.map(safeName).join("_") || "group";
    return [`avg_${m}_${g}`, `deviation_percent`];
  }
  return [];
}

// ---------------------------------------------------------------------------
// ClickHouse — построение запроса для правил с расширенными условиями
// ---------------------------------------------------------------------------

export interface BuildAdvancedSqlArgs {
  fromClause: string;
  /** Колонки основной группировки правила (одна или несколько). */
  ruleGroupBy: string[];
  /** SQL-выражение для столбца/calc-поля (для groupBy + подгрупп). */
  colExpr: (name: string) => string;
  /**
   * SQL «строкового» уровня для метрики (для `sumIf`/`sum`): сырая колонка
   * → `quoteIdent`; ROW-calc → `formulaToSql`; AGG-calc → `formulaToSql(stripAggregates(...))`
   * (для SUM-агрегатов это корректно — даёт сумму по строкам периода).
   */
  metricRowExpr: (name: string) => string | null;
  /**
   * SQL-выражение столбца-даты, уже приведённое к типу, сравнимому с `today()`
   * (например `toDate(\`day\`)` для строкового столбца). `null` — если столбца
   * даты в датасете нет.
   */
  dateColumnExpr: string | null;
  /**
   * Период правила в днях. Используется как окно для агрегатов
   * threshold-условий и `min_spend_filter` (когда есть столбец даты) —
   * чтобы они согласовывались с period_change / vs_group_avg, а не считались
   * по всей истории таблицы.
   */
  periodDays: number;
  conditions: AlertCondition[];
  minSpendCol: string | null;
  minSpendValue: number | null;
  /** Value-фильтры (по значениям полей) — добавляются в WHERE до агрегации. */
  valueFilters?: FilterCondition[];
  /** Aggregate-calc поля нельзя класть в WHERE — пропускаем такие value-фильтры. */
  isAggCalc?: (name: string) => boolean;
  /** Display-метрики таблицы (помимо метрик условий) — для рендера {table}. */
  displayMetrics?: PivotValueConfig[];
}

export interface BuiltAdvancedSql {
  sql: string;
  placeholderColumns: string[];
}

export function buildAdvancedSql(
  a: BuildAdvancedSqlArgs,
): BuiltAdvancedSql | { error: string } {
  const conds = desugarConditions(a.conditions);
  const periodConds = conds.filter(
    (c): c is AlertConditionPeriodChange => c.kind === "period_change",
  );
  const groupAvgConds = conds.filter(
    (c): c is AlertConditionVsGroupAvg => c.kind === "vs_group_avg",
  );
  const thresholdConds = conds.flatMap((c) =>
    !c.kind || c.kind === "threshold"
      ? [{ metric: c.metric, operator: c.operator, value: c.value }]
      : [],
  );

  if (periodConds.length > 0 && !a.dateColumnExpr) {
    return {
      error:
        "Правило сравнивает метрику за разные периоды, но в датасете не найден столбец даты (day / date / event_date …).",
    };
  }

  const dateCol = a.dateColumnExpr;
  const periodCond = (days: number) =>
    `${dateCol} >= today() - ${Math.max(1, Math.floor(days))}`;

  /** SQL значения метрики за период: ratio → sumIf/sumIf, иначе sumIf. */
  const periodValueSql = (
    numExpr: string,
    denExpr: string | null,
    days: number,
  ): string => {
    const n = dateCol ? `sumIf(${numExpr}, ${periodCond(days)})` : `sum(${numExpr})`;
    if (!denExpr) return n;
    const d = dateCol ? `sumIf(${denExpr}, ${periodCond(days)})` : `sum(${denExpr})`;
    return `if((${d}) != 0, (${n}) / (${d}), NULL)`;
  };

  const innerSelect: string[] = [];
  const groupByExprs: string[] = [];
  const seenGroupCols = new Set<string>();
  for (const g of a.ruleGroupBy) {
    if (seenGroupCols.has(g)) continue;
    seenGroupCols.add(g);
    innerSelect.push(`${a.colExpr(g)} AS ${quoteIdent(g)}`);
    groupByExprs.push(a.colExpr(g));
  }
  // Колонки подгрупп vs_group_avg, которых ещё нет в основной группировке,
  // добавляем в inner SELECT/GROUP BY — чтобы они были доступны для PARTITION BY.
  for (const c of groupAvgConds) {
    for (const g of c.groupBy) {
      if (!g || seenGroupCols.has(g)) continue;
      seenGroupCols.add(g);
      innerSelect.push(`${a.colExpr(g)} AS ${quoteIdent(g)}`);
      groupByExprs.push(a.colExpr(g));
    }
  }

  const placeholderColumns: string[] = [];
  const whereParts: string[] = [];

  const periodSum = (expr: string): string =>
    dateCol
      ? `sumIf(${expr}, ${periodCond(a.periodDays)})`
      : `sum(${expr})`;

  // Алиасы уже добавленных агрегатов — чтобы display-метрики не дублировали.
  const aggAliases = new Set<string>();

  // threshold
  for (const c of thresholdConds) {
    const expr = a.metricRowExpr(c.metric);
    if (expr === null)
      return { error: `Метрика «${c.metric}» в условии не поддерживается.` };
    const alias = `SUM(${c.metric})`;
    if (!aggAliases.has(alias)) {
      innerSelect.push(`${periodSum(expr)} AS ${quoteIdent(alias)}`);
      aggAliases.add(alias);
    }
    whereParts.push(`${quoteIdent(alias)} ${sqlOp(c.operator)} ${Number(c.value)}`);
  }

  // display-метрики таблицы (помимо метрик условий) — для рендера {table}.
  const baseCond = dateCol ? periodCond(a.periodDays) : null;
  for (const m of a.displayMetrics ?? []) {
    const alias = valueKey(m); // `${agg}(${col})`
    if (aggAliases.has(alias)) continue;
    const expr = a.metricRowExpr(m.column);
    if (expr === null) continue; // display-метрику молча пропускаем
    aggAliases.add(alias);
    innerSelect.push(
      `${metricAggSql(m.aggregation, expr, baseCond)} AS ${quoteIdent(alias)}`,
    );
  }

  // min_spend
  if (a.minSpendCol && typeof a.minSpendValue === "number") {
    innerSelect.push(`${periodSum(quoteIdent(a.minSpendCol))} AS ${quoteIdent("__min_spend")}`);
    whereParts.push(`${quoteIdent("__min_spend")} >= ${Number(a.minSpendValue)}`);
  }

  // period_change (+desugared trend)
  for (const c of periodConds) {
    const numExpr = a.metricRowExpr(c.metric);
    if (numExpr === null)
      return { error: `Метрика «${c.metric}» в условии период-к-периоду не поддерживается.` };
    let denExpr: string | null = null;
    if (c.metricDenominator) {
      denExpr = a.metricRowExpr(c.metricDenominator);
      if (denExpr === null)
        return { error: `Знаменатель «${c.metricDenominator}» не поддерживается.` };
    }
    const base = metricBaseName(c);
    const aliasA = `${base}_${c.periodA}d`;
    const aliasB = `${base}_${c.periodB}d`;
    const changeAlias = `${base}_change_percent`;
    const valA = periodValueSql(numExpr, denExpr, c.periodA);
    const valB = periodValueSql(numExpr, denExpr, c.periodB);
    innerSelect.push(`(${valA}) AS ${quoteIdent(aliasA)}`);
    innerSelect.push(`(${valB}) AS ${quoteIdent(aliasB)}`);
    innerSelect.push(
      `if((${valB}) != 0, round(((${valA}) - (${valB})) / (${valB}) * 100, 2), NULL) AS ${quoteIdent(changeAlias)}`,
    );
    placeholderColumns.push(aliasA, aliasB, changeAlias);
    if (denExpr) {
      const n = safeName(c.metric);
      innerSelect.push(
        `${dateCol ? `sumIf(${numExpr}, ${periodCond(c.periodA)})` : `sum(${numExpr})`} AS ${quoteIdent(`${n}_${c.periodA}d`)}`,
      );
      innerSelect.push(
        `${dateCol ? `sumIf(${numExpr}, ${periodCond(c.periodB)})` : `sum(${numExpr})`} AS ${quoteIdent(`${n}_${c.periodB}d`)}`,
      );
      placeholderColumns.push(`${n}_${c.periodA}d`, `${n}_${c.periodB}d`);
    }
    whereParts.push(`${quoteIdent(changeAlias)} ${sqlOp(c.operator)} ${Number(c.value)}`);
  }

  // vs_group_avg
  // Несколько условий vs_group_avg на ту же метрику (с разными периодами)
  // должны иметь УНИКАЛЬНЫЕ алиасы — иначе CH валится с
  // MULTIPLE_EXPRESSIONS_FOR_ALIAS. Первое — без суффикса (совместимо со
  // старыми шаблонами, которые ссылаются на `deviation_percent`), остальные
  // получают `_2`, `_3`, …
  const outerExtra: string[] = [];
  for (let idx = 0; idx < groupAvgConds.length; idx += 1) {
    const c = groupAvgConds[idx];
    const numExpr = a.metricRowExpr(c.metric);
    if (numExpr === null)
      return { error: `Метрика «${c.metric}» в условии «vs среднее по группе» не поддерживается.` };
    let denExpr: string | null = null;
    if (c.metricDenominator) {
      denExpr = a.metricRowExpr(c.metricDenominator);
      if (denExpr === null)
        return { error: `Знаменатель «${c.metricDenominator}» не поддерживается.` };
    }
    const suffix = idx === 0 ? "" : `_${idx + 1}`;
    const base = metricBaseName(c);
    const valAlias = `${base}_val${suffix}`;
    innerSelect.push(
      `(${periodValueSql(numExpr, denExpr, c.periodDays)}) AS ${quoteIdent(valAlias)}`,
    );
    // PARTITION BY — ПОЛНАЯ подгруппа условия (c.groupBy). Иначе, когда подгруппа
    // ⊆ ruleGroupBy (напр. ruleGroupBy=[channel,code,GEO], подгруппа=[channel,GEO]),
    // окно схлопывалось до всех строк → «среднее по всему датасету» вместо
    // среднего по подгруппе. Все c.groupBy присутствуют в inner SELECT (см. выше).
    const partCols = c.groupBy.filter((g) => g).map((g) => quoteIdent(g));
    const partition =
      partCols.length > 0 ? `PARTITION BY ${partCols.join(", ")}` : "";
    const gName = c.groupBy.map(safeName).join("_") || "group";
    const avgAlias = `avg_${base}_${gName}${suffix}`;
    const devAlias = `deviation_percent${suffix}`;

    if (denExpr) {
      // RATIO-метрика (CPA=cost/subs): среднее по группе считаем ВЗВЕШЕННО —
      // настоящий групповой CPA = SUM(cost) / SUM(subs), а не среднее из CPA
      // каждой строки («среднее средних» искажает в разы). Для этого выносим
      // в inner суммы числителя/знаменателя за период, в outer — окно SUM/SUM.
      const numAlias = `${base}_num${suffix}`;
      const denAlias = `${base}_den${suffix}`;
      const periodNum = dateCol
        ? `sumIf(${numExpr}, ${periodCond(c.periodDays)})`
        : `sum(${numExpr})`;
      const periodDen = dateCol
        ? `sumIf(${denExpr}, ${periodCond(c.periodDays)})`
        : `sum(${denExpr})`;
      innerSelect.push(`(${periodNum}) AS ${quoteIdent(numAlias)}`);
      innerSelect.push(`(${periodDen}) AS ${quoteIdent(denAlias)}`);
      outerExtra.push(
        `if(sum(${quoteIdent(denAlias)}) OVER (${partition}) != 0, ` +
          `sum(${quoteIdent(numAlias)}) OVER (${partition}) / ` +
          `sum(${quoteIdent(denAlias)}) OVER (${partition}), NULL) ` +
          `AS ${quoteIdent(avgAlias)}`,
      );
    } else {
      // Обычная (не-ratio) метрика: простое среднее корректно.
      outerExtra.push(
        `avg(${quoteIdent(valAlias)}) OVER (${partition}) AS ${quoteIdent(avgAlias)}`,
      );
    }
    outerExtra.push(
      `if(${quoteIdent(avgAlias)} != 0, round((${quoteIdent(valAlias)} - ${quoteIdent(avgAlias)}) / ${quoteIdent(avgAlias)} * 100, 2), NULL) AS ${quoteIdent(devAlias)}`,
    );
    placeholderColumns.push(avgAlias, devAlias);
    whereParts.push(
      `${quoteIdent(devAlias)} ${sqlOp(c.operator)} ${Number(c.value)}`,
    );
  }

  // Value-фильтры (по значениям полей) — WHERE до агрегации.
  const innerWhere = valueFiltersToSqlWhere(a.valueFilters, a.colExpr, a.isAggCalc);
  const innerWhereClause =
    innerWhere.length > 0 ? ` WHERE ${innerWhere.join(" AND ")}` : "";
  const innerSql = `SELECT ${innerSelect.join(", ")} FROM ${a.fromClause}${innerWhereClause} GROUP BY ${groupByExprs.join(", ")}`;
  const midSql = `SELECT ${["*", ...outerExtra].join(", ")} FROM (${innerSql})`;
  const whereClause = whereParts.length > 0 ? ` WHERE ${whereParts.join(" AND ")}` : "";
  const sql = `SELECT * FROM (${midSql})${whereClause} LIMIT 500`;

  return { sql, placeholderColumns: Array.from(new Set(placeholderColumns)) };
}

// ---------------------------------------------------------------------------
// Демо-путь — те же условия на in-memory данных
// ---------------------------------------------------------------------------

export interface DemoMetricFn {
  (rows: QueryResultRow[]): number | null;
}

export function evaluateAdvancedDemo(args: {
  rule: AlertRule;
  allRows: QueryResultRow[];
  dateColumn: string | null;
  /** Агрегат метрики (raw/ROW → sum; AGG-calc → формула) по набору строк. */
  metricAgg: (name: string) => DemoMetricFn;
}): { matched: QueryResultRow[]; placeholderColumns: string[] } {
  const { rule, allRows, dateColumn, metricAgg } = args;
  const conds = desugarConditions(rule.conditions);

  const cutoffStr = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - Math.max(1, Math.floor(days)));
    return d.toISOString().slice(0, 10);
  };
  const rowsInLastNDays = (days: number) => {
    if (!dateColumn) return allRows;
    const cutoff = cutoffStr(days);
    return allRows.filter((r) => {
      const v = r[dateColumn];
      return typeof v === "string" ? v.slice(0, 10) >= cutoff : true;
    });
  };
  const sameGroup = (r: QueryResultRow, ref: QueryResultRow) =>
    rule.groupBy.every(
      (g) => String(r[g] ?? "") === String(ref[g] ?? ""),
    );
  const byGroup = (rows: QueryResultRow[], cols: string[]) => {
    const m = new Map<string, QueryResultRow[]>();
    for (const r of rows) {
      const k = cols.map((c) => String(r[c] ?? "")).join(GROUP_KEY_SEP);
      const arr = m.get(k) ?? [];
      if (!m.has(k)) m.set(k, arr);
      arr.push(r);
    }
    return m;
  };
  /** Значение метрики (с учётом ratio) по набору строк. */
  const metricVal = (
    c: { metric: string; metricDenominator?: string },
    rows: QueryResultRow[],
  ): number | null => {
    const n = metricAgg(c.metric)(rows) ?? 0;
    if (!c.metricDenominator) return n;
    const d = metricAgg(c.metricDenominator)(rows) ?? 0;
    return d !== 0 ? n / d : null;
  };

  const baseGroups = byGroup(rowsInLastNDays(rule.periodDays), rule.groupBy);
  const placeholderColumns: string[] = [];
  const matched: QueryResultRow[] = [];

  for (const [, rows] of baseGroups) {
    const ref = rows[0]!;
    const out: QueryResultRow = {};
    for (const g of rule.groupBy) out[g] = ref[g] ?? null;
    // Все простые-именованные поля группы → доступны как плейсхолдеры.
    for (const [k, v] of Object.entries(ref)) {
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) && !(k in out)) out[k] = v as string | number | null;
    }
    let ok = true;
    // Индекс vs_group_avg-условия — для уникальных алиасов val/avg/dev
    // (см. buildAdvancedSql: первое условие без суффикса, остальные с `_N`).
    let vsGroupAvgIdx = 0;

    for (const c of conds) {
      if (c.kind === "trend") continue; // desugared
      if (c.kind === "period_change") {
        const base = metricBaseName(c);
        const gRows = (d: number) => rowsInLastNDays(d).filter((r) => sameGroup(r, ref));
        const a = metricVal(c, gRows(c.periodA)) ?? 0;
        const b = metricVal(c, gRows(c.periodB)) ?? 0;
        const change = b !== 0 ? Number((((a - b) / b) * 100).toFixed(2)) : null;
        out[`${base}_${c.periodA}d`] = round4(a);
        out[`${base}_${c.periodB}d`] = round4(b);
        out[`${base}_change_percent`] = change;
        placeholderColumns.push(`${base}_${c.periodA}d`, `${base}_${c.periodB}d`, `${base}_change_percent`);
        if (c.metricDenominator) {
          const n = safeName(c.metric);
          out[`${n}_${c.periodA}d`] = round4(metricAgg(c.metric)(gRows(c.periodA)) ?? 0);
          out[`${n}_${c.periodB}d`] = round4(metricAgg(c.metric)(gRows(c.periodB)) ?? 0);
          placeholderColumns.push(`${n}_${c.periodA}d`, `${n}_${c.periodB}d`);
        }
        out[`SUM(${c.metric})`] = round4(metricAgg(c.metric)(gRows(c.periodA)) ?? 0);
        if (change === null || !compareNum(change, c.operator, c.value)) ok = false;
      } else if (c.kind === "vs_group_avg") {
        const base = metricBaseName(c);
        const periodRows = rowsInLastNDays(c.periodDays);
        const myRows = periodRows.filter((r) => sameGroup(r, ref));
        const myVal = metricVal(c, myRows) ?? 0;
        const subKey = (c.groupBy ?? []).map((g) => String(ref[g] ?? "")).join(GROUP_KEY_SEP);
        const peers = byGroup(periodRows, rule.groupBy);
        // Соседи в той же подгруппе.
        const peerGroups: QueryResultRow[][] = [];
        for (const [, pr] of peers) {
          const pSub = (c.groupBy ?? []).map((g) => String(pr[0]?.[g] ?? "")).join(GROUP_KEY_SEP);
          if (pSub === subKey) peerGroups.push(pr);
        }
        let avg: number;
        if (c.metricDenominator) {
          // RATIO: взвешенное среднее = SUM(числитель) / SUM(знаменатель) по
          // всем соседям подгруппы (настоящий групповой CPA), а не среднее CPA.
          let sumNum = 0;
          let sumDen = 0;
          for (const pr of peerGroups) {
            sumNum += metricAgg(c.metric)(pr) ?? 0;
            sumDen += metricAgg(c.metricDenominator)(pr) ?? 0;
          }
          avg = sumDen !== 0 ? sumNum / sumDen : 0;
        } else {
          // Обычная метрика: простое среднее значений соседей корректно.
          const peerVals = peerGroups
            .map((pr) => metricVal(c, pr))
            .filter((v): v is number => v !== null && Number.isFinite(v));
          avg = peerVals.length
            ? peerVals.reduce((s, x) => s + x, 0) / peerVals.length
            : 0;
        }
        const dev = avg !== 0 ? Number((((myVal - avg) / avg) * 100).toFixed(2)) : null;
        const gName = (c.groupBy ?? []).map(safeName).join("_") || "group";
        const suffix = vsGroupAvgIdx === 0 ? "" : `_${vsGroupAvgIdx + 1}`;
        vsGroupAvgIdx += 1;
        const avgKey = `avg_${base}_${gName}${suffix}`;
        const devKey = `deviation_percent${suffix}`;
        out[avgKey] = round4(avg);
        out[devKey] = dev;
        out[`SUM(${c.metric})`] = round4(metricAgg(c.metric)(myRows) ?? 0);
        placeholderColumns.push(avgKey, devKey);
        if (dev === null || !compareNum(dev, c.operator, c.value)) ok = false;
      } else {
        const v = metricAgg(c.metric)(rows) ?? 0;
        out[`SUM(${c.metric})`] = round4(v);
        if (!compareNum(v, c.operator, c.value)) ok = false;
      }
    }

    if (typeof rule.minSpendFilter === "number" && rule.minSpendFilter > 0) {
      const spendName = "spend" in ref ? "spend" : "cost" in ref ? "cost" : null;
      if (spendName) {
        const total = rows.reduce((s, r) => {
          const n = Number(r[spendName!]);
          return s + (Number.isFinite(n) ? n : 0);
        }, 0);
        if (total < rule.minSpendFilter) ok = false;
      }
    }

    if (ok) matched.push(out);
  }

  return { matched, placeholderColumns: Array.from(new Set(placeholderColumns)) };
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

function compareNum(a: number, op: AlertConditionOperator, b: number): boolean {
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

/** Собирает плейсхолдер→строка из строки матча (для Telegram-шаблона). */
export function placeholdersFromRow(
  row: QueryResultRow,
  placeholderColumns: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of placeholderColumns) {
    const v = row[col];
    out[col] =
      v === null || v === undefined
        ? "—"
        : typeof v === "number"
          ? Number.isInteger(v)
            ? String(v)
            : v.toFixed(2)
          : String(v);
  }
  return out;
}

/**
 * SQL «строкового» уровня для метрики. AGG-вычисляемое поле раскрывается
 * через `stripAggregates` — для SUM-агрегатов даёт корректное выражение
 * (`sum`/`sumIf` по нему = сумма за период).
 */
export function metricRowExprSql(
  name: string,
  opts: {
    isCalc: (n: string) => boolean;
    isAggCalc: (n: string) => boolean;
    resolvedAst: (n: string) => FormulaNode | null;
  },
): string | null {
  if (!opts.isCalc(name)) return quoteIdent(name);
  const ast = opts.resolvedAst(name);
  if (!ast) return quoteIdent(name);
  return formulaToSql(opts.isAggCalc(name) ? stripAggregates(ast) : ast, quoteIdent);
}
