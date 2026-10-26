import type { DatasetColumnType } from "./types";

/**
 * Маппинг ClickHouse-типа в семантический тип датасета. Корректно
 * разворачивает вложенные обёртки `Nullable(...)` и `LowCardinality(...)`.
 *
 * Поведение:
 * - `Nullable(X)` → рекурсивно по `X` (обёртка над nullable не меняет смысла).
 * - `LowCardinality(X)` → рекурсивно по `X`. Если `X` строковый
 *   (`String / FixedString / UUID`) → `category` (это типичный
 *   ClickHouse-паттерн для перечислений с низкой кардинальностью).
 *   Иначе остаётся тип `X` (например, `LowCardinality(Int64)` → `integer`).
 * - `Enum8`, `Enum16` → `category`.
 * - `IntN`, `UIntN` → `integer`.
 * - `Float32`, `Float64`, `Decimal` → `float`.
 * - `Date`, `Date32` → `date`.
 * - `DateTime`, `DateTime64` → `datetime`.
 * - `Bool`, `Boolean` → `boolean`.
 * - `String`, `FixedString`, `UUID` → `string`.
 * - `Array(...)`, `Map(...)`, `Tuple(...)` → `string` (сложные типы как fallback).
 * - всё остальное → `string`.
 */
export function mapClickhouseType(chType: string): DatasetColumnType {
  const t = chType.trim();
  const lower = t.toLowerCase();

  // Разворачиваем обёртки.
  const nullableMatch = t.match(/^Nullable\((.+)\)$/i);
  if (nullableMatch) return mapClickhouseType(nullableMatch[1]);

  const lowCardMatch = t.match(/^LowCardinality\((.+)\)$/i);
  if (lowCardMatch) {
    const inner = mapClickhouseType(lowCardMatch[1]);
    // LowCardinality(String) и подобные → category. Для других типов
    // оставляем семантику внутреннего (например, LowCardinality(Int64) → integer).
    return inner === "string" ? "category" : inner;
  }

  if (/^Enum(8|16)/i.test(t)) return "category";

  if (lower === "bool" || lower === "boolean") return "boolean";

  if (/^u?int(8|16|32|64|128|256)$/i.test(t)) return "integer";

  if (/^float(32|64)$/i.test(t)) return "float";
  if (/^decimal/i.test(t)) return "float";

  if (lower === "date" || lower === "date32") return "date";
  if (/^datetime(64)?/i.test(t)) return "datetime";

  if (/^fixedstring/i.test(t) || lower === "string" || lower === "uuid") {
    return "string";
  }

  // Array / Map / Tuple и любые иные — fallback в строку.
  return "string";
}

export const DATASET_TYPE_LABELS: Record<DatasetColumnType, string> = {
  integer: "Целое",
  float: "Дробное",
  string: "Текст",
  date: "Дата",
  datetime: "Дата и время",
  boolean: "Да/Нет",
  category: "Категория",
};

export const DATASET_TYPE_DESCRIPTIONS: Record<DatasetColumnType, string> = {
  integer: "Целые числа: счётчики, подсчёты",
  float: "Дробные числа: суммы, метрики, проценты",
  string: "Произвольный текст",
  date: "Только дата (без времени)",
  datetime: "Дата и время",
  boolean: "Логическое значение (да/нет)",
  category: "Категориальное значение для группировок",
};

export function isMeasureType(t: DatasetColumnType): boolean {
  return t === "integer" || t === "float";
}

export function isDimensionType(t: DatasetColumnType): boolean {
  return (
    t === "category" ||
    t === "string" ||
    t === "date" ||
    t === "datetime" ||
    t === "boolean"
  );
}
