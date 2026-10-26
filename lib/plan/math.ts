import type { PlanContext, PlanDirection, PlanField } from "../types";
import { daysInMonth, monthOf, moscowDate, normalizeDate } from "./dates";
import { planColumnName } from "./fields";
import type { PlanGroup, Row } from "./types";

/** Допуск сравнения с границами светофора. */
const EPS = 1e-9;

/** Светофор выполнения. */
export type TrafficLight = "ok" | "warn" | "bad";

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Убирает хвосты плавающей точки (88.00000000000001 → 88). */
function clean(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * Выполнение как доля (0.88 = 88%) по направлению поля:
 * `higher` и `target` — факт ÷ план; `lower` — план ÷ факт.
 * Нет плана/факта или деление на 0 → `null`.
 */
export function completion(
  fact: number | null | undefined,
  plan: number | null | undefined,
  direction: PlanDirection,
): number | null {
  if (!isNum(fact) || !isNum(plan)) return null;
  if (direction === "lower") {
    if (fact === 0) return null;
    return plan / fact;
  }
  if (plan === 0) return null;
  return fact / plan;
}

/**
 * Светофор по доле выполнения (0.95 = 95%). Границы — история 31, включительно:
 * - `higher` / `lower`: ok ≥ 95%, warn 80% ≤ x < 95%, bad < 80%;
 * - `target`: ok 95% ≤ x ≤ 105%, warn 85% ≤ x < 95% или 105% < x ≤ 115%, иначе bad.
 */
export function trafficLight(
  pct: number | null | undefined,
  direction: PlanDirection,
): TrafficLight | null {
  if (!isNum(pct)) return null;
  // Границы включительно с допуском 1e-9: 0.95 / 1.15 из арифметики не
  // промахиваются мимо границы, а 0.94996 остаётся ниже 95%.
  const ge = (a: number, b: number) => a >= b - EPS;
  const le = (a: number, b: number) => a <= b + EPS;
  const x = pct;
  if (direction === "target") {
    if (ge(x, 0.95) && le(x, 1.05)) return "ok";
    if ((ge(x, 0.85) && x < 0.95) || (x > 1.05 && le(x, 1.15))) return "warn";
    return "bad";
  }
  if (ge(x, 0.95)) return "ok";
  if (ge(x, 0.8)) return "warn";
  return "bad";
}

/** Светофор для значения колонки `· выполнение %` (она в процентах: 88 = 88%). */
export function completionColumnLight(
  valuePercent: number | null | undefined,
  direction: PlanDirection,
): TrafficLight | null {
  return isNum(valuePercent) ? trafficLight(valuePercent / 100, direction) : null;
}

/** Прогноз на конец периода (только «объём»): факт ÷ план на дату × план. */
export function forecast(
  fact: number | null | undefined,
  planToDate: number | null | undefined,
  plan: number | null | undefined,
): number | null {
  if (!isNum(fact) || !isNum(planToDate) || !isNum(plan) || planToDate === 0) {
    return null;
  }
  return (fact / planToDate) * plan;
}

/** Значения плана для одной группы и одного поля. */
export interface PlanCellValues {
  plan: number | null;
  planToDate: number | null;
  fact: number | null;
  /** Доля: 0.88 = 88%. */
  completion: number | null;
  forecast: number | null;
  deviation: number | null;
}

/**
 * Считает план/факт одного поля по набору дат.
 * - «Объём»: дневной план = план месяца ÷ дней в месяце.
 *   `plan` = Σ планов месяцев, которых касаются даты (по дате — дневной план);
 *   `planToDate` = Σ дневного плана по датам ≤ сегодня.
 * - «Ставка»: `plan` = `planToDate` = план, средневзвешенный по дням.
 *
 * `factByDate` (необязательно) — факт группы по дням. У «объёма», если часть
 * дат группы попадает в месяцы без плана, факт для выполнения, прогноза и
 * отклонения — сумма только по датам месяцев с планом: иначе без фильтра
 * периода факт за четыре месяца делился бы на план одного (дефект Т07-4).
 * «Ставка» сравнивает уровень, а не сумму, — её факт берётся как есть.
 */
export function planCell(
  field: PlanField,
  monthValues: Record<string, number> | undefined,
  dates: string[],
  fact: number | null | undefined,
  today: string,
  groupedByDate: boolean,
  factByDate?: Record<string, number | null> | null,
): PlanCellValues {
  const planOf = (month: string): number | null => {
    const v = monthValues?.[month];
    return isNum(v) ? v : null;
  };
  let f = isNum(fact) ? fact : null;
  if (field.kind === "volume" && factByDate === null) {
    // Факт по дням нужен, но его нет: не подставляем факт за все месяцы
    // (он завысил бы выполнение) — честное «нет значения».
    f = null;
  } else if (field.kind === "volume" && factByDate) {
    const factDates = Object.keys(factByDate);
    if (factDates.some((d) => planOf(monthOf(d)) === null)) {
      let sum = 0;
      let has = false;
      for (const d of factDates) {
        const v = factByDate[d];
        if (planOf(monthOf(d)) === null || !isNum(v)) continue;
        sum += v;
        has = true;
      }
      f = has ? sum : null;
    }
  }

  let plan: number | null = null;
  let planToDate: number | null = null;

  if (field.kind === "volume") {
    const months = new Set<string>();
    let toDate = 0;
    let toDateHas = false;
    let daily = 0;
    let dailyHas = false;
    for (const d of dates) {
      const m = monthOf(d);
      months.add(m);
      const p = planOf(m);
      if (p === null) continue;
      const perDay = p / daysInMonth(m);
      daily += perDay;
      dailyHas = true;
      if (d <= today) {
        toDate += perDay;
        toDateHas = true;
      }
    }
    if (groupedByDate) {
      plan = dailyHas ? daily : null;
    } else {
      let sum = 0;
      let has = false;
      for (const m of Array.from(months)) {
        const p = planOf(m);
        if (p !== null) {
          sum += p;
          has = true;
        }
      }
      plan = has ? sum : null;
    }
    planToDate = toDateHas ? toDate : null;
  } else {
    let sum = 0;
    let n = 0;
    for (const d of dates) {
      const p = planOf(monthOf(d));
      if (p === null) continue;
      sum += p;
      n++;
    }
    plan = n > 0 ? sum / n : null;
    planToDate = plan;
  }

  const pct = completion(f, planToDate, field.direction);
  return {
    plan: plan === null ? null : clean(plan),
    planToDate: planToDate === null ? null : clean(planToDate),
    fact: f,
    completion: pct,
    forecast:
      field.kind === "volume" ? nullableClean(forecast(f, planToDate, plan)) : null,
    deviation: f !== null && planToDate !== null ? clean(f - planToDate) : null,
  };
}

/** Факт одного поля по дням из `PlanGroup.factsByDate` (дата нормализуется до дня). */
function factsOfField(
  byDate: Record<string, Record<string, number | null>>,
  sourceColumn: string,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const raw of Object.keys(byDate)) {
    const d = normalizeDate(raw);
    if (!d) continue;
    const v = byDate[raw]?.[sourceColumn];
    if (!isNum(v)) continue;
    out[d] = (out[d] ?? 0) + v;
  }
  return out;
}

function nullableClean(v: number | null): number | null {
  return v === null ? null : clean(v);
}

function uniqueDates(raw: string[]): string[] {
  const set = new Set<string>();
  for (const r of raw) {
    const d = normalizeDate(r);
    if (d) set.add(d);
  }
  return Array.from(set).sort();
}

/**
 * Дозаполняет группы результата виртуальными колонками плана
 * (`«<подпись> · план»`, `· план на дату`, `· выполнение %` (в процентах),
 * `· прогноз`, `· отклонение`). Ключи пишутся простыми именами колонок —
 * перенос под ключи агрегатов (`SUM(...)`) делает вызывающий код.
 *
 * Группа с `groupedByDate: true` берёт свои даты (дневной план). Любая другая группа (итог,
 * клиент, канал) берёт все даты результата: план задан на проект целиком,
 * поэтому в разрезе показывается общий план (история 30).
 * `today` — момент «сейчас»; дата берётся по Europe/Moscow.
 */
export function fillPlanColumns(
  groups: PlanGroup[],
  ctx: PlanContext,
  today: Date,
): Row[] {
  const todayStr = moscowDate(today);
  const allDates = uniqueDates(groups.flatMap((g) => g.dates));
  const fields = [...ctx.fields].sort((a, b) => a.sortOrder - b.sortOrder);

  return groups.map((g) => {
    // Дневной план — только по явному флагу вызывающего.
    const byDate = g.groupedByDate === true;
    const dates = byDate ? uniqueDates(g.dates) : allDates;
    const out: Row = { ...g.row };
    for (const field of fields) {
      const cell = planCell(
        field,
        ctx.values[field.id],
        dates,
        g.facts[field.sourceColumn],
        todayStr,
        byDate,
        g.factsByDate === null
          ? null
          : g.factsByDate
            ? factsOfField(g.factsByDate, field.sourceColumn)
            : undefined,
      );
      out[planColumnName(field.label, "plan")] = cell.plan;
      out[planColumnName(field.label, "planToDate")] = cell.planToDate;
      out[planColumnName(field.label, "completion")] =
        cell.completion === null ? null : clean(cell.completion * 100);
      out[planColumnName(field.label, "forecast")] = cell.forecast;
      out[planColumnName(field.label, "deviation")] = cell.deviation;
    }
    return out;
  });
}
