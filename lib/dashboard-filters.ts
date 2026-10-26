import type {
  DashboardFilter,
  DashboardFilterType,
  DatasetColumn,
  DatasetColumnType,
  FilterCondition,
} from "./types";
// Относительные импорты: модуль компилируется в тест scripts/test-query-engine.cjs.
import { isRelativePeriod, resolveRelativePeriod } from "./plan/period";

/**
 * Значение фильтра по умолчанию на момент `now`. Относительный дефолт
 * (`{ relative: "currentMonth" }`) пересчитывается в `{from, to}` текущего
 * месяца по Москве; фиксированный (`{from, to}`, строка, массив) — как есть.
 */
export function resolveFilterDefault(
  filter: DashboardFilter,
  now: Date = new Date(),
): unknown {
  const d = filter.defaultValue;
  return isRelativePeriod(d) ? resolveRelativePeriod(d, now) : d;
}

/**
 * Значение фильтра с учётом значения по умолчанию: пока пользователь не трогал
 * фильтр (ключа нет в `active`), действует дефолт (например, «Период» шаблона
 * план/факт = текущий месяц). Явно очищенный фильтр (`{}`, `[]`, `""`) остаётся
 * пустым — к дефолту не откатывается. «Сбросить все фильтры» очищает `active`
 * и возвращает значения по умолчанию.
 */
export function effectiveFilterValue(
  filter: DashboardFilter,
  active: Record<string, unknown>,
  now: Date = new Date(),
): unknown {
  return Object.prototype.hasOwnProperty.call(active, filter.id)
    ? active[filter.id]
    : resolveFilterDefault(filter, now);
}

// Convert active filter values (kept in dashboardStore.activeFilters) to the
// FilterCondition[] shape understood by /api/query and lib/aggregation.
export function buildGlobalFilterConditions(
  filters: DashboardFilter[],
  active: Record<string, unknown>,
  now: Date = new Date(),
): FilterCondition[] {
  const out: FilterCondition[] = [];
  for (const f of filters) {
    const v = effectiveFilterValue(f, active, now);
    if (v === undefined || v === null) continue;

    if (f.type === "select") {
      const s = typeof v === "string" ? v : String(v);
      if (!s) continue;
      out.push({
        id: f.id,
        column: f.column,
        operator: "=",
        value: s,
      });
    } else if (f.type === "multi_select") {
      const arr = Array.isArray(v) ? v.map((x) => String(x)) : [];
      if (arr.length === 0) continue;
      out.push({
        id: f.id,
        column: f.column,
        operator: "in",
        value: JSON.stringify(arr),
      });
    } else if (f.type === "date_range" || f.type === "number_range") {
      const range = v as { from?: unknown; to?: unknown };
      if (range && range.from !== undefined && range.from !== "" && range.from !== null) {
        out.push({
          id: `${f.id}-from`,
          column: f.column,
          operator: ">=",
          value: String(range.from),
        });
      }
      if (range && range.to !== undefined && range.to !== "" && range.to !== null) {
        out.push({
          id: `${f.id}-to`,
          column: f.column,
          operator: "<=",
          value: String(range.to),
        });
      }
    }
  }
  return out;
}

// Guess a reasonable DashboardFilter type based on a dataset column type.
export function inferFilterType(
  columnType: DatasetColumnType,
): DashboardFilterType {
  if (columnType === "date" || columnType === "datetime") return "date_range";
  if (columnType === "integer" || columnType === "float") return "number_range";
  return "multi_select";
}

export function findColumnType(
  columns: DatasetColumn[],
  column: string,
): DatasetColumnType | null {
  const c = columns.find((x) => x.name === column);
  return c ? c.datasetType : null;
}
