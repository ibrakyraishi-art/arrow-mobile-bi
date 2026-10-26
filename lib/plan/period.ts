import { monthBounds, moscowMonth } from "./dates";

/**
 * Относительный период для значения фильтра по умолчанию: пересчитывается при
 * каждом открытии дашборда (по Москве), а не фиксируется датами при сборке.
 */
export interface RelativePeriod {
  relative: "currentMonth";
}

/** «Текущий месяц» — дефолт фильтра «Период» шаблона план/факт. */
export const CURRENT_MONTH_PERIOD: RelativePeriod = { relative: "currentMonth" };

export function isRelativePeriod(value: unknown): value is RelativePeriod {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { relative?: unknown }).relative === "currentMonth"
  );
}

/** Относительный период → `{from, to}` (`YYYY-MM-DD`) на момент `now`. */
export function resolveRelativePeriod(
  period: RelativePeriod,
  now: Date,
): { from: string; to: string } {
  // Сейчас вариант один — текущий месяц.
  void period.relative;
  return monthBounds(moscowMonth(now));
}
