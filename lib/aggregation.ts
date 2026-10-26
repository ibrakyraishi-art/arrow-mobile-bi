import type {
  AggregationType,
  FilterCondition,
  PivotValueConfig,
  QueryResultRow,
} from "./types";
import { evaluateAggregateFormula, type FormulaNode } from "./formula";

/**
 * Aggregate-level вычисляемое поле для `aggregate()`: AST с уже
 * разрешёнными ссылками (только сырые столбцы / константы / `agg`-узлы).
 */
export interface AggregateCalcField {
  /** Имя поля (как в `PivotValueConfig.column`). */
  name: string;
  datasetType: "float" | "integer";
  ast: FormulaNode;
}

export function applyFilters(
  rows: QueryResultRow[],
  filters: FilterCondition[] | undefined,
): QueryResultRow[] {
  if (!filters || filters.length === 0) return rows;
  return rows.filter((row) =>
    filters.every((f) => evaluateFilter(row[f.column], f.operator, f.value)),
  );
}

function evaluateFilter(
  value: unknown,
  op: FilterCondition["operator"],
  target: string,
): boolean {
  if (value === null || value === undefined) return false;
  const numValue = typeof value === "number" ? value : Number(value);
  const numTarget = Number(target);
  const isNumeric = !Number.isNaN(numValue) && !Number.isNaN(numTarget);

  switch (op) {
    case "=":
      return String(value) === target;
    case "!=":
      return String(value) !== target;
    case ">":
      return isNumeric ? numValue > numTarget : String(value) > target;
    case "<":
      return isNumeric ? numValue < numTarget : String(value) < target;
    case ">=":
      return isNumeric ? numValue >= numTarget : String(value) >= target;
    case "<=":
      return isNumeric ? numValue <= numTarget : String(value) <= target;
    case "contains":
      return String(value).toLowerCase().includes(target.toLowerCase());
    case "in": {
      const list = parseInList(target);
      if (list.length === 0) return true;
      return list.includes(String(value));
    }
    default:
      return true;
  }
}

function parseInList(raw: string): string[] {
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

export function aggregate(
  rows: QueryResultRow[],
  groupBy: string[],
  values: PivotValueConfig[],
  /**
   * Aggregate-level вычисляемые поля. Если `v.column` в `values` совпадает
   * с именем такого поля — оно НЕ агрегируется обычным путём, а считается
   * целиком на уровне группы через `evaluateAggregateFormula` (формула уже
   * содержит SUM/AVG/…).
   */
  aggregateCalcFields?: AggregateCalcField[],
): QueryResultRow[] {
  if (groupBy.length === 0 && values.length === 0) return rows;
  const aggCalcMap = new Map(
    (aggregateCalcFields ?? []).map((f) => [f.name, f] as const),
  );
  const map = new Map<string, QueryResultRow>();
  const counts = new Map<string, Record<string, number>>();
  const groupRows = new Map<string, QueryResultRow[]>();

  for (const row of rows) {
    const key = groupKey(row, groupBy);
    let acc = map.get(key);
    let cnt = counts.get(key);
    if (!acc) {
      acc = {};
      for (const g of groupBy) acc[g] = row[g] ?? null;
      for (const v of values) {
        const outCol = valueKey(v);
        if (aggCalcMap.has(v.column)) {
          acc[outCol] = null;
        } else {
          acc[outCol] =
            v.aggregation === "MIN" || v.aggregation === "MAX" ? null : 0;
        }
      }
      map.set(key, acc);
      cnt = {};
      counts.set(key, cnt);
      groupRows.set(key, []);
    }
    if (!cnt) cnt = counts.get(key)!;
    groupRows.get(key)!.push(row);

    for (const v of values) {
      if (aggCalcMap.has(v.column)) continue;
      const outCol = valueKey(v);
      const raw = row[v.column];
      const n = typeof raw === "number" ? raw : Number(raw);
      const isNum = !Number.isNaN(n);

      if (v.aggregation === "COUNT") {
        acc[outCol] = ((acc[outCol] as number) || 0) + 1;
      } else if (isNum) {
        cnt[outCol] = (cnt[outCol] ?? 0) + 1;
        const current = acc[outCol];
        if (v.aggregation === "SUM" || v.aggregation === "AVG") {
          acc[outCol] = ((current as number) || 0) + n;
        } else if (v.aggregation === "MIN") {
          acc[outCol] = current === null ? n : Math.min(current as number, n);
        } else if (v.aggregation === "MAX") {
          acc[outCol] = current === null ? n : Math.max(current as number, n);
        }
      }
    }
  }

  // finalize AVG / round SUM / compute aggregate calc fields
  for (const [key, acc] of map) {
    const cnt = counts.get(key)!;
    for (const v of values) {
      const outCol = valueKey(v);
      const calc = aggCalcMap.get(v.column);
      if (calc) {
        const result = evaluateAggregateFormula(
          calc.ast,
          groupRows.get(key) ?? [],
        );
        acc[outCol] =
          result === null
            ? null
            : calc.datasetType === "integer"
              ? Math.trunc(result)
              : Number(result.toFixed(4));
      } else if (v.aggregation === "AVG") {
        const c = cnt[outCol] || 0;
        acc[outCol] = c > 0 ? Number(((acc[outCol] as number) / c).toFixed(4)) : 0;
      } else if (v.aggregation === "SUM" && typeof acc[outCol] === "number") {
        acc[outCol] = Number((acc[outCol] as number).toFixed(4));
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Ключ группы строки — тот же, по которому `aggregate()` склеивает строки.
 * Нужен движку плана, чтобы сопоставить группе её даты.
 */
export function groupKey(row: QueryResultRow, groupBy: string[]): string {
  return groupBy.map((g) => String(row[g] ?? "")).join("\u0001");
}

/**
 * Значения комбо-графика: `values` (1-е — столбцы, далее — линии), а если
 * пусто — старая одиночная мера `yAxis`. Одно правило для движка,
 * конструктора и рендера.
 */
export function comboValues(config: {
  values?: PivotValueConfig[];
  yAxis?: PivotValueConfig;
}): PivotValueConfig[] {
  if ((config.values ?? []).length > 0) return config.values ?? [];
  return config.yAxis ? [config.yAxis] : [];
}

export function valueKey(v: PivotValueConfig): string {
  return `${v.aggregation}(${v.column})`;
}

export const ALL_AGGREGATIONS: AggregationType[] = [
  "SUM",
  "AVG",
  "COUNT",
  "MIN",
  "MAX",
];
