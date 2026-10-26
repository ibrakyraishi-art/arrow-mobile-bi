import type { CalculatedFieldFormat, PlanDirection, PlanKind } from "../types";
import type { TrafficLight } from "./math";

/**
 * Ответ `GET /api/plan/[id]/summary?month=YYYY-MM` (контракт interfaces.md).
 * Единственное объявление: его импортируют маршрут и клиент страницы плана.
 */
export interface PlanSummaryField {
  fieldId: string;
  label: string;
  kind: PlanKind;
  direction: PlanDirection;
  format?: CalculatedFieldFormat;
  plan: number | null;
  planToDate: number | null;
  fact: number | null;
  /** Доля: 0.88 = 88%. */
  completion: number | null;
  forecast: number | null;
  deviation: number | null;
  light: TrafficLight | null;
  daily: Array<{ date: string; fact: number | null; plan: number | null }>;
}

export interface PlanSummaryResponse {
  projectId: string;
  month: string;
  /** Сегодня по Москве, `YYYY-MM-DD`. */
  today: string;
  daysInMonth: number;
  daysElapsed: number;
  fields: PlanSummaryField[];
  /** Источник недоступен: поля с null, текст ошибки для UI. */
  error?: string;
}
