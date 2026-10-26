import type { PlanDirection } from "../types";
import type { TrafficLight } from "./math";
import { noNegativeZero } from "../format-value";

/**
 * Подпись светофора по направлению поля — одна на всё приложение (метрика,
 * прогресс, страница плана). Для «ближе к плану» (target) жёлтый/красный — это
 * отклонение в любую сторону (и недотрата, и перерасход), а не «отстаём».
 */
export const TRAFFIC_LIGHT_LABEL: Record<PlanDirection, Record<TrafficLight, string>> = {
  higher: { ok: "в плане", warn: "отстаём", bad: "сильно отстаём" },
  lower: { ok: "в плане", warn: "отстаём", bad: "сильно отстаём" },
  target: { ok: "в плане", warn: "отклонение", bad: "сильное отклонение" },
};

/** Подпись светофора для значения поля с направлением `direction`. */
export function trafficLightLabel(light: TrafficLight, direction: PlanDirection): string {
  return TRAFFIC_LIGHT_LABEL[direction][light];
}

/**
 * Процент выполнения для показа: значение в процентах (как в колонке
 * `· выполнение %`: 88 = 88%) → «88%», до 10% — с одним знаком («7,5%»).
 * Нет значения → «—». Для доли (0.88) передайте `share * 100`.
 */
export function formatCompletionPercent(valuePercent: number | null | undefined): string {
  if (valuePercent === null || valuePercent === undefined || !Number.isFinite(valuePercent)) {
    return "—";
  }
  const digits = Math.abs(valuePercent) < 10 ? 1 : 0;
  // Округлённое до нуля отрицательное — «0%», без «-0%».
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(
    noNegativeZero(valuePercent, digits),
  )}%`;
}
