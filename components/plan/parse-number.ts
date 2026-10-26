/**
 * Разбор и показ чисел в сетке плана «поле × месяц». Чистые функции без
 * зависимостей (тест — `components/plan/parse-number.test.cjs`).
 */

/** Результат разбора ячейки: `value: null` — ячейка пустая (= плана нет). */
export type PlanInputResult = { ok: true; value: number | null } | { ok: false };

/** Пробелы всех видов: обычный, неразрывный, узкий неразрывный (так форматирует ru-RU). */
const SPACES = /[\s  ]/g;

/**
 * Ввод ячейки → число. Понимает «3 100 000,5», «3100000.5», «1,5»;
 * разрешает хвост ₽ / $ / % (их ставят по привычке). Пустая строка = `null`.
 * Отрицательные, экспонента, два разделителя дроби и любые буквы — ошибка.
 */
export function parsePlanInput(raw: string): PlanInputResult {
  const compact = raw.replace(SPACES, "");
  if (compact === "") return { ok: true, value: null };
  const body = compact.replace(/[₽$%]$/, "");
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(body)) return { ok: false };
  const value = Number(body.replace(",", "."));
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

/**
 * Число → текст ячейки: разряды обычным пробелом, дробь запятой, до 6 знаков
 * после запятой (без хвостов плавающей точки). `null` → пустая ячейка.
 */
export function formatPlanInput(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const rounded = Math.round(value * 1e6) / 1e6;
  const [int, frac] = String(Math.abs(rounded)).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${rounded < 0 ? "-" : ""}${grouped}${frac ? `,${frac}` : ""}`;
}
