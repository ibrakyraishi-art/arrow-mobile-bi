import type {
  PlanContext,
  PlanField,
  PlanKind,
  PlanDirection,
  PlanVirtualKind,
  CalculatedFieldFormat,
} from "../types";
import type { Dataset } from "../types";
import type { VirtualField } from "./types";
import { datasetColumnLabel } from "./dashboard";

/** Порядок виртуальных метрик у поля плана. */
export const PLAN_VIRTUAL_KINDS: PlanVirtualKind[] = [
  "plan",
  "planToDate",
  "completion",
  "forecast",
  "deviation",
];

const SUFFIX: Record<PlanVirtualKind, string> = {
  plan: "план",
  planToDate: "план на дату",
  completion: "выполнение %",
  forecast: "прогноз",
  deviation: "отклонение",
};

/** Имя виртуальной колонки: `«Расход · план»` и т.д. */
export function planColumnName(label: string, kind: PlanVirtualKind): string {
  return `${label} · ${SUFFIX[kind]}`;
}

/** Разбирает имя колонки: это виртуальное поле плана? Если да — какое поле и какая метрика. */
export function resolvePlanColumn(
  name: string,
  fields: PlanField[],
): { field: PlanField; virtualKind: PlanVirtualKind } | null {
  for (const field of fields) {
    for (const virtualKind of PLAN_VIRTUAL_KINDS) {
      if (planColumnName(field.label, virtualKind) === name) {
        return { field, virtualKind };
      }
    }
  }
  return null;
}

const DIRECTION_HINT: Record<PlanDirection, string> = {
  higher: "больше — лучше: факт ÷ план на дату",
  lower: "меньше — лучше: план на дату ÷ факт",
  target: "ближе к плану — лучше: факт ÷ план на дату, светофор ловит и недотрату, и перерасход",
};

const LIGHT_ZONES_PLAIN = "Зелёный ≥ 95%, жёлтый 80–95%, красный < 80%.";
const LIGHT_HINT: Record<PlanDirection, string> = {
  higher: LIGHT_ZONES_PLAIN,
  lower: LIGHT_ZONES_PLAIN,
  target: "Зелёный 95–105%, жёлтый 85–95% и 105–115%, иначе красный.",
};

const BREAKDOWN_HINT =
  "План задан на проект целиком: в разрезе по колонке вне плана (канал, гео) факт делится по значениям, а план показывается общий на проект.";

/**
 * Какой факт идёт в выполнение, прогноз и отклонение. «Объём» — только за даты
 * месяцев, на которые вписан план (без фильтра периода факт других месяцев не
 * смешивается с планом одного); «ставка» — уровень за весь выбранный период.
 */
const FACT_HINT_VOLUME =
  "Факт берётся только за даты месяцев, на которые вписан план.";
const FACT_HINT_RATE =
  "Факт — уровень за весь выбранный период, включая месяцы без плана.";

function describe(field: PlanField, kind: PlanVirtualKind): string {
  const isVolume = field.kind === "volume";
  const factHint = isVolume ? FACT_HINT_VOLUME : FACT_HINT_RATE;
  switch (kind) {
    case "plan":
      return isVolume
        ? `План «${field.label}» на месяц (сумма месяцев периода). В группировке по дате — дневной план: месяц ÷ дней в месяце. ${BREAKDOWN_HINT}`
        : `Целевой уровень «${field.label}», средневзвешенный по дням периода. ${BREAKDOWN_HINT}`;
    case "planToDate":
      return isVolume
        ? `Сколько должно быть к сегодняшнему дню: сумма дневного плана по прошедшим дням периода с данными. ${BREAKDOWN_HINT}`
        : `Для ставки совпадает с «· план»: целевой уровень, средневзвешенный по дням периода. ${BREAKDOWN_HINT}`;
    case "completion":
      return `Выполнение темпа, % (${DIRECTION_HINT[field.direction]}). ${LIGHT_HINT[field.direction]} ${factHint} ${BREAKDOWN_HINT}`;
    case "forecast":
      return isVolume
        ? `Прогноз на конец периода при текущем темпе: факт ÷ план на дату × план. ${factHint} ${BREAKDOWN_HINT}`
        : "Для ставки прогноз не считается — всегда пусто.";
    case "deviation":
      return `Факт − план на дату (в единицах поля). ${factHint} ${BREAKDOWN_HINT}`;
  }
}

function formatOf(field: PlanField, kind: PlanVirtualKind): CalculatedFieldFormat | undefined {
  if (kind === "completion") return "percent";
  return field.format;
}

/** 5 виртуальных метрик на каждое поле плана, в порядке полей (sortOrder). */
export function planVirtualFields(project: Pick<PlanContext, "fields">): VirtualField[] {
  const out: VirtualField[] = [];
  const fields = [...project.fields].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const field of fields) {
    for (const virtualKind of PLAN_VIRTUAL_KINDS) {
      out.push({
        name: planColumnName(field.label, virtualKind),
        fieldId: field.id,
        label: field.label,
        virtualKind,
        sourceColumn: field.sourceColumn,
        kind: field.kind,
        direction: field.direction,
        datasetType: "float",
        format: formatOf(field, virtualKind),
        aggregation: "SUM",
        description: describe(field, virtualKind),
      });
    }
  }
  return out;
}

/**
 * Подсказка значений по умолчанию для нового поля плана (история 21):
 * CPI/CPA/CPC и прочие «цены» — ставка + «меньше — лучше»; ROAS/ROI/CTR/CR
 * и проценты — ставка + «больше — лучше»; расход/бюджет — объём + «ближе к
 * плану»; остальное (установки, покупки) — объём + «больше — лучше».
 */
export function suggestPlanFieldDefaults(column: string): {
  kind: PlanKind;
  direction: PlanDirection;
} {
  const c = column.toLowerCase();
  if (/(^|[^a-zа-я])(cp[a-z]|cpm|cpc|cpi|cpa|cpl|cac|цена|стоимость)/.test(c)) {
    return { kind: "rate", direction: "lower" };
  }
  if (/(roas|roi|ctr|cr|romi|ltv|%|конверс)/.test(c)) {
    return { kind: "rate", direction: "higher" };
  }
  if (/(spend|cost|budget|расход|бюджет|затрат)/.test(c)) {
    return { kind: "volume", direction: "target" };
  }
  return { kind: "volume", direction: "higher" };
}

/** Частые имена колонок → человеческая подпись (без учёта регистра). */
const COMMON_COLUMN_LABELS: Record<string, string> = {
  spend: "Расход",
  installs: "Установки",
  purchases: "Покупки",
  revenue: "Выручка",
  clicks: "Клики",
  impressions: "Показы",
  registrations: "Регистрации",
  cpi: "CPI",
  roas: "ROAS",
};

const CURRENCY_SUFFIX: Record<string, string> = { _rub: " ₽", _usd: " $" };

/**
 * Подпись нового поля плана по умолчанию: описание колонки датасета (как
 * `datasetColumnLabel`), иначе словарь частых имён (`spend_rub` → «Расход ₽»),
 * иначе имя колонки как есть.
 */
export function suggestPlanFieldLabel(
  dataset: Pick<Dataset, "columns"> | undefined,
  column: string,
): string {
  const fromDataset = datasetColumnLabel(dataset ?? { columns: [] }, column);
  if (fromDataset !== column) return fromDataset;
  const lower = column.toLowerCase();
  const suffix = Object.keys(CURRENCY_SUFFIX).find((s) => lower.endsWith(s));
  const base = suffix ? lower.slice(0, -suffix.length) : lower;
  const word = COMMON_COLUMN_LABELS[base];
  if (!word) return column;
  return suffix ? `${word}${CURRENCY_SUFFIX[suffix]}` : word;
}
