/**
 * Даты для математики плана. Все даты — строки `YYYY-MM-DD`, месяцы — `YYYY-MM`.
 * Календарная арифметика идёт в UTC, чтобы не зависеть от часового пояса
 * машины; «сегодня» переводится в дату по Europe/Moscow.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Дата `YYYY-MM-DD` из строки даты/даты-времени (`2026-10-01`, `2026-10-01 12:00:00`, ISO). */
export function normalizeDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const m = DATE_RE.exec(String(value).trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Месяц `YYYY-MM` даты `YYYY-MM-DD`. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Число дней в месяце `YYYY-MM`. */
export function daysInMonth(month: string): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  // День 0 следующего месяца = последний день текущего.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** «Сегодня» как дата `YYYY-MM-DD` по Москве. */
export function moscowDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Текущий месяц `YYYY-MM` по Москве. */
export function moscowMonth(now: Date): string {
  return monthOf(moscowDate(now));
}

/** Сдвиг месяца `YYYY-MM` на `delta` месяцев (может быть отрицательным). */
export function addMonths(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + delta;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Первый и последний день месяца `YYYY-MM`. */
export function monthBounds(month: string): { from: string; to: string } {
  return {
    from: `${month}-01`,
    to: `${month}-${String(daysInMonth(month)).padStart(2, "0")}`,
  };
}
