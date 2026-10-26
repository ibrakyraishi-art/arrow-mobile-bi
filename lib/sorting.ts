/**
 * Утилиты сортировки для таблиц TanStack и графиков Recharts.
 *
 * Цели:
 *  - Единая точка маппинга `DatasetColumnType` (или произвольной строки
 *    типа из БД) в подходящую `sortingFn` TanStack Table:
 *    - даты → `'datetime'`
 *    - числа → `'basic'`
 *    - текст → `alphanumericLocale` (Intl.Collator c ru+en)
 *  - NULL/undefined всегда уходят вниз. Реализуется через
 *    `sortUndefined: 'last'` на ColumnDef + `accessorFn`, который
 *    приводит `null → undefined` (см. примеры использования в PivotTable).
 *  - Для графиков — детект «дата-подобной» строки по ISO-формату, чтобы
 *    скиснуть значения по оси X в хронологическом порядке.
 */

import type { Row, SortingFnOption } from "@tanstack/react-table";
import type { DatasetColumnType } from "./types";

const collator = new Intl.Collator(["ru", "en"], {
  sensitivity: "base",
  numeric: true,
});

/**
 * Локалезависимая сортировка строк (ru/en, регистронезависимая,
 * с поддержкой смешанных «алфанумерик» строк типа `Кампания 9` < `Кампания 10`).
 * `null/undefined` обрабатывается на уровне TanStack (`sortUndefined: 'last'`),
 * сюда не доходит.
 *
 * Функция объявлена как generic, чтобы TanStack мог специализировать её
 * под конкретный `TData` в `ColumnDef<TData>` без явных каст-ов на стороне
 * вызова.
 */
export function alphanumericLocale<TData>(
  rowA: Row<TData>,
  rowB: Row<TData>,
  columnId: string,
): number {
  const av = rowA.getValue(columnId);
  const bv = rowB.getValue(columnId);
  return collator.compare(String(av ?? ""), String(bv ?? ""));
}

/**
 * Маппинг типа колонки → TanStack `sortingFn`. Понимает наш
 * `DatasetColumnType`, а также «сырые» строки из БД (timestamp, decimal,
 * numeric, text, varchar и т.п.) — на случай, если тип колонки не
 * нормализован через `mapClickhouseType`.
 */
export function getSortingFnFor<TData>(
  type: DatasetColumnType | string | undefined,
): SortingFnOption<TData> {
  if (!type) return alphanumericLocale;
  const t = String(type).toLowerCase();

  if (t === "date" || t === "datetime" || t === "timestamp") {
    return "datetime";
  }
  if (
    t === "integer" ||
    t === "float" ||
    t === "number" ||
    t === "decimal" ||
    t === "numeric"
  ) {
    return "basic";
  }
  if (
    t === "string" ||
    t === "text" ||
    t === "varchar" ||
    t === "category" ||
    t === "boolean"
  ) {
    return alphanumericLocale;
  }
  return alphanumericLocale;
}

/**
 * Грубый детект «дата-подобной» строки. Используется для оси X в графиках,
 * когда тип xAxis-колонки не известен (агрегаты, произвольный SQL).
 * Принимает: `2026-05-09`, `2026-05-09T22:30:00`, `2026/05/09 22:30:00`.
 */
export function isDateLike(value: unknown): boolean {
  if (value instanceof Date) return true;
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v.length < 8) return false;
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v)) return true;
  // Полноценный ISO с миллисекундами/таймзоной
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return true;
  return false;
}

/**
 * Сортирует `data` по полю `xKey`, исходя из типа значений на оси X.
 * Используется в `ChartRenderer`:
 *  - даты → asc по `Date.parse` (хронологический порядок слева направо)
 *  - числа → asc по числовому значению
 *  - иначе → asc по локали (ru+en, numeric: true)
 *
 * Поведение nullsLast: пустые/NaN значения уезжают в конец независимо
 * от направления.
 */
export function sortDataForXAxis<T extends Record<string, unknown>>(
  data: T[],
  xKey: string,
  xType: DatasetColumnType | string | undefined,
): T[] {
  if (data.length === 0) return data;

  const t = String(xType ?? "").toLowerCase();
  const isDate =
    t === "date" ||
    t === "datetime" ||
    t === "timestamp" ||
    (xType === undefined && data.some((r) => isDateLike(r[xKey])));
  const isNumber =
    t === "integer" ||
    t === "float" ||
    t === "number" ||
    t === "decimal" ||
    t === "numeric";

  const copy = data.slice();

  if (isDate) {
    return copy.sort((a, b) => {
      const av = a[xKey];
      const bv = b[xKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      const at = Date.parse(String(av));
      const bt = Date.parse(String(bv));
      const aBad = Number.isNaN(at);
      const bBad = Number.isNaN(bt);
      if (aBad && bBad) return 0;
      if (aBad) return 1;
      if (bBad) return -1;
      return at - bt;
    });
  }

  if (isNumber) {
    return copy.sort((a, b) => {
      const av = a[xKey];
      const bv = b[xKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      const an = Number(av);
      const bn = Number(bv);
      const aBad = Number.isNaN(an);
      const bBad = Number.isNaN(bn);
      if (aBad && bBad) return 0;
      if (aBad) return 1;
      if (bBad) return -1;
      return an - bn;
    });
  }

  return copy.sort((a, b) => {
    const av = a[xKey];
    const bv = b[xKey];
    if (av == null) return 1;
    if (bv == null) return -1;
    return collator.compare(String(av), String(bv));
  });
}
