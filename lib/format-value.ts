import type {
  AggregationType,
  CalculatedField,
  CalculatedFieldFormat,
  DatasetColumn,
  PivotValueConfig,
} from "./types";
import { datasetColumnLabel } from "./plan/dashboard";

/**
 * Форматирует значение вычисляемого поля для отображения в таблицах
 * и графиках (PivotTable, ChartRenderer tooltip, ResultMetricStrip).
 *
 * Контракт:
 *   - null/undefined/NaN → "—"
 *   - integer            → 1 234 (без дробной части)
 *   - number             → 1 234,56 (до 2 знаков после запятой)
 *   - currency_usd       → $1,234 (от 1 000 — без центов), $109.12
 *   - currency_rub       → 1 760 000 ₽ (от 1 000 — без копеек), 109,12 ₽
 *   - percent            → 12,5% (значение трактуется как уже в процентах,
 *                          т.е. 12.5 — это 12.5%, а не 1250%)
 * Отрицательного нуля нет ни в одном формате: −0,004 → «0».
 */
export function formatCalculatedValue(
  value: number | null | undefined,
  format: CalculatedFieldFormat | undefined,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const f = format ?? "number";
  switch (f) {
    case "integer":
      return new Intl.NumberFormat("ru-RU", {
        maximumFractionDigits: 0,
      }).format(noNegativeZero(Math.trunc(value), 0));
    case "currency_usd": {
      const digits = moneyDigits(value);
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(noNegativeZero(value, digits));
    }
    case "currency_rub": {
      const digits = moneyDigits(value);
      return new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: "RUB",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(noNegativeZero(value, digits));
    }
    case "percent":
      return `${new Intl.NumberFormat("ru-RU", {
        maximumFractionDigits: 2,
      }).format(noNegativeZero(value, 2))}%`;
    case "number":
    default: {
      const isInt = value % 1 === 0;
      const digits = isInt ? 0 : 2;
      return new Intl.NumberFormat("ru-RU", {
        maximumFractionDigits: digits,
      }).format(noNegativeZero(value, digits));
    }
  }
}

/** Деньги: суммы от 1 000 — без копеек/центов, меньше — с двумя знаками. */
function moneyDigits(value: number): number {
  return Math.abs(value) >= 1000 ? 0 : 2;
}

/**
 * Значение, которое после округления до `digits` знаков станет нулём,
 * показываем как ноль без знака (никакого «-0», «-0,00 ₽»).
 */
export function noNegativeZero(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(Math.abs(value) * factor) === 0 ? 0 : value;
}

export const CALCULATED_FIELD_FORMAT_OPTIONS: {
  value: CalculatedFieldFormat;
  label: string;
  example: string;
}[] = [
  { value: "number", label: "Число", example: "1 234,56" },
  { value: "integer", label: "Целое", example: "1 234" },
  { value: "currency_usd", label: "Валюта USD", example: "$1,234 · $9.99" },
  { value: "currency_rub", label: "Валюта RUB", example: "1 234 ₽ · 109,12 ₽" },
  { value: "percent", label: "Процент", example: "12,5%" },
];

/** Формат колонки по имени: `spend_rub` → ₽, `revenue_usd` → $; иначе не задан. */
export function guessColumnFormat(column: string): CalculatedFieldFormat | undefined {
  if (/_rub$/i.test(column)) return "currency_rub";
  if (/_usd$/i.test(column)) return "currency_usd";
  return undefined;
}

/**
 * Формат значения меры: явный выбор в визуализации (`valueFormats`) → формат
 * вычисляемого поля / поля плана → угадывание по суффиксу (кроме COUNT —
 * количество строк не бывает рублями). `undefined` — обычное число.
 */
export function resolveValueFormat(
  value: Pick<PivotValueConfig, "column" | "aggregation">,
  opts: {
    valueFormats?: Record<string, CalculatedFieldFormat>;
    calculatedFields?: Pick<CalculatedField, "name" | "format">[];
  } = {},
): CalculatedFieldFormat | undefined {
  const explicit = opts.valueFormats?.[value.column];
  if (explicit) return explicit;
  const calc = opts.calculatedFields?.find((c) => c.name === value.column);
  if (calc) return calc.format;
  if (value.aggregation === "COUNT") return undefined;
  return guessColumnFormat(value.column);
}

// ---------------------------------------------------------------------------
// Даты для показа: оси, тултипы, ячейки. Значение из запроса — строка ISO
// («2026-10-02», «2026-10-02 14:30:00», «2026-10-02T00:00:00Z») или месяц
// «2026-10». Разбираем по частям строки, без часовых поясов: дата из данных
// — это календарный день, а не момент времени.
// ---------------------------------------------------------------------------

const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

const ISO_DAY_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const ISO_MONTH_RE = /^(\d{4})-(\d{2})$/;

interface ParsedDate {
  y: string;
  m: string;
  d?: string;
  /** «14:30», если время не полночь. */
  time?: string;
}

function parseIsoDate(value: unknown): ParsedDate | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  const day = ISO_DAY_RE.exec(s);
  if (day) {
    const [, y, m, d, hh, mm] = day;
    const time = hh && mm && `${hh}:${mm}` !== "00:00" ? `${hh}:${mm}` : undefined;
    return { y, m, d, time };
  }
  const month = ISO_MONTH_RE.exec(s);
  if (month) return { y: month[1], m: month[2] };
  return null;
}

function monthLabel(p: ParsedDate): string {
  return `${MONTH_SHORT[Number(p.m) - 1] ?? p.m} ${p.y}`;
}

/** Похоже ли значение на дату/месяц ISO (для подписей осей и ячеек). */
export function isIsoDateValue(value: unknown): boolean {
  return parseIsoDate(value) !== null;
}

/**
 * Подпись даты на оси: «02.10»; если период шире года (`wide`) — «02.10.26»;
 * месяц «2026-10» — «окт 2026». Не дата — как есть.
 */
export function formatDateAxis(value: unknown, opts: { wide?: boolean } = {}): string {
  const p = parseIsoDate(value);
  if (!p) return value === null || value === undefined ? "—" : String(value);
  if (!p.d) return monthLabel(p);
  return opts.wide ? `${p.d}.${p.m}.${p.y.slice(2)}` : `${p.d}.${p.m}`;
}

/** Дата в тултипе и в ячейке: «02.10.2026» (со временем — «02.10.2026 14:30»), месяц — «окт 2026». */
export function formatDateTooltip(value: unknown): string {
  const p = parseIsoDate(value);
  if (!p) return value === null || value === undefined ? "—" : String(value);
  if (!p.d) return monthLabel(p);
  const date = `${p.d}.${p.m}.${p.y}`;
  return p.time ? `${date} ${p.time}` : date;
}

/** Даты значений охватывают больше года — на оси нужен год («02.10.26»). */
export function isWideDateRange(values: unknown[]): boolean {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    const p = parseIsoDate(v);
    if (!p) continue;
    const t = Date.UTC(Number(p.y), Number(p.m) - 1, Number(p.d ?? "1"));
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!Number.isFinite(min)) return false;
  return max - min > 365 * 24 * 3600 * 1000;
}

// ---------------------------------------------------------------------------
// Человеческие подписи: легенды, тултипы, оси, подписи метрик, заголовки
// сводной. Сырое имя колонки остаётся только в конструкторе (вторичной строкой).
// ---------------------------------------------------------------------------

/** Агрегация по-русски — одна на всё приложение. */
export const AGGREGATION_LABEL: Record<AggregationType, string> = {
  SUM: "сумма",
  AVG: "среднее",
  COUNT: "количество",
  MIN: "минимум",
  MAX: "максимум",
};

export interface LabelContext {
  /** Колонки датасета — короткое описание колонки становится подписью. */
  datasetColumns?: DatasetColumn[];
  /** Вычисляемые поля и поля плана — подписываются своим именем, без агрегации. */
  calculatedFields?: Pick<CalculatedField, "name">[];
}

/** Подпись колонки-измерения: имя вычисляемого поля или описание колонки датасета. */
export function columnLabel(column: string, ctx: LabelContext = {}): string {
  if (ctx.calculatedFields?.some((c) => c.name === column)) return column;
  return datasetColumnLabel({ columns: ctx.datasetColumns ?? [] }, column);
}

/**
 * Подпись значения (меры): «Расход ₽, сумма», «Установки, среднее»;
 * вычисляемое поле / поле плана — своим именем («CPI ₽», «Расход · план»).
 */
export function valueLabel(
  value: Pick<PivotValueConfig, "column" | "aggregation">,
  ctx: LabelContext = {},
): string {
  if (ctx.calculatedFields?.some((c) => c.name === value.column)) return value.column;
  const agg = AGGREGATION_LABEL[value.aggregation] ?? value.aggregation.toLowerCase();
  return `${columnLabel(value.column, ctx)}, ${agg}`;
}
