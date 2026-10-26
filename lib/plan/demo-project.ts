import type { PlanField, PlanProject } from "../types";
import { addMonths, moscowMonth } from "./dates";

/**
 * Демо-план «Демо: все клиенты» на демо-датасете `installs_daily`.
 * Живёт только в памяти (как остальные демо-объекты), правке не подлежит.
 *
 * Числа плана — константы ниже; генератор демо-данных (lib/demo-data.ts)
 * калибруется под них по `DEMO_PLAN_CALIBRATION`, чтобы текущий месяц давал
 * наглядную картину: расход ≈ 88%, установки ≈ 100%, CPI в зелёной зоне,
 * покупки в жёлтой.
 */

/** Id демо-датасета. Должен совпадать с `DEMO_DATASET_ID` из lib/demo-data.ts (interfaces.md). */
export const DEMO_PLAN_DATASET_ID = "demo-dataset-installs";
export const DEMO_PLAN_PROJECT_ID = "demo-plan-project";

const FIELD = {
  spend: "demo-plan-field-spend",
  installs: "demo-plan-field-installs",
  purchases: "demo-plan-field-purchases",
  cpi: "demo-plan-field-cpi",
  roas: "demo-plan-field-roas",
} as const;

type DemoFieldKey = keyof typeof FIELD;

/**
 * План на месяц по смещению от текущего месяца (0 — текущий, −1 — прошлый…),
 * на все демо-клиенты вместе. CPI плана = расход / установки (≈124 ₽).
 */
export const DEMO_PLAN_MONTHLY: Record<number, Record<DemoFieldKey, number>> = {
  [-3]: { spend: 2700000, installs: 22000, purchases: 1700, cpi: 123, roas: 110 },
  [-2]: { spend: 2850000, installs: 23000, purchases: 1800, cpi: 124, roas: 112 },
  [-1]: { spend: 3000000, installs: 24000, purchases: 1900, cpi: 125, roas: 115 },
  [0]: { spend: 3100000, installs: 25000, purchases: 2000, cpi: 124, roas: 120 },
};

/**
 * Во сколько раз факт текущего месяца должен отличаться от плана на дату
 * (темп с начала месяца) — для калибровки генератора демо-данных.
 * Прошлые месяцы — около плана (0.95–1.02).
 *  - расход 0.88 (жёлтый для «ближе к плану»: 85–95%);
 *  - установки 1.00 (зелёный);
 *  - покупки 0.87 (жёлтый);
 *  - CPI факта ≈ 0.88 × 124 ≈ 109 ₽ → выполнение 124 / 109 ≈ 114% (зелёный, «меньше — лучше»);
 *  - ROAS факта ≈ 1.0 × план (зелёный).
 */
export const DEMO_PLAN_CALIBRATION = {
  currentMonth: { spend: 0.88, installs: 1.0, purchases: 0.87, roas: 1.0 },
  pastMonths: { min: 0.95, max: 1.02 },
} as const;

function demoFields(): PlanField[] {
  const base = { projectId: DEMO_PLAN_PROJECT_ID };
  return [
    { ...base, id: FIELD.spend, label: "Расход", sourceColumn: "spend_rub", kind: "volume", direction: "target", format: "currency_rub", sortOrder: 0 },
    { ...base, id: FIELD.installs, label: "Установки", sourceColumn: "installs", kind: "volume", direction: "higher", format: "integer", sortOrder: 1 },
    { ...base, id: FIELD.purchases, label: "Покупки", sourceColumn: "purchases", kind: "volume", direction: "higher", format: "integer", sortOrder: 2 },
    { ...base, id: FIELD.cpi, label: "CPI", sourceColumn: "CPI ₽", kind: "rate", direction: "lower", format: "currency_rub", sortOrder: 3 },
    { ...base, id: FIELD.roas, label: "ROAS", sourceColumn: "ROAS %", kind: "rate", direction: "higher", format: "percent", sortOrder: 4 },
  ];
}

/** Собирает демо-проект относительно «сейчас» (месяцы — последние 3 полных + текущий, по Москве). */
export function buildDemoPlanProject(now: Date): PlanProject {
  const current = moscowMonth(now);
  const values: PlanProject["values"] = {};
  for (const key of Object.keys(FIELD) as DemoFieldKey[]) {
    const byMonth: Record<string, number> = {};
    for (const offset of [-3, -2, -1, 0]) {
      byMonth[addMonths(current, offset)] = DEMO_PLAN_MONTHLY[offset][key];
    }
    values[FIELD[key]] = byMonth;
  }
  const createdAt = `${addMonths(current, -3)}-01T00:00:00.000Z`;
  return {
    id: DEMO_PLAN_PROJECT_ID,
    name: "Демо: все клиенты",
    datasetId: DEMO_PLAN_DATASET_ID,
    dateColumn: "date",
    fields: demoFields(),
    values,
    isDemo: true,
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * Снимок на момент загрузки модуля — только для обратной совместимости
 * (месяцы могут устареть). Стор и движок используют `buildDemoPlanProject(new Date())`.
 */
export const DEMO_PLAN_PROJECT: PlanProject = buildDemoPlanProject(new Date());

export function isDemoPlanProjectId(id: string): boolean {
  return id === DEMO_PLAN_PROJECT_ID;
}
