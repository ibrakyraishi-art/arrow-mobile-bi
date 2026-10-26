"use client";

import { useEffect } from "react";
import type { Dataset, DatasetColumn, PlanDirection, PlanKind } from "@/lib/types";
import type { TrafficLight } from "@/lib/plan";
import { DEMO_PLAN_DATASET_ID } from "@/lib/plan";
import { usePlanStore } from "@/stores/planStore";
import { cn } from "@/lib/utils";

export const KIND_LABEL: Record<PlanKind, string> = {
  volume: "Объём",
  rate: "Ставка",
};

export const KIND_HINT: Record<PlanKind, string> = {
  volume: "суммируется по дням: расход, установки, покупки",
  rate: "целевой уровень, на дни не делится: CPI, ROAS",
};

export const DIRECTION_LABEL: Record<PlanDirection, string> = {
  higher: "Больше — лучше",
  lower: "Меньше — лучше",
  target: "Ближе к плану — лучше",
};

/** Классы текста/фона по светофору (токены `ok/warn/bad` из таска 01). */
export function lightText(light: TrafficLight | null | undefined): string {
  if (light === "ok") return "text-ok";
  if (light === "warn") return "text-warn";
  if (light === "bad") return "text-bad";
  return "text-muted-foreground";
}

export function LightDot({
  light,
  className,
}: {
  light: TrafficLight | null | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
        light === "ok" && "bg-ok",
        light === "warn" && "bg-warn",
        light === "bad" && "bg-bad",
        !light && "bg-muted-foreground/40",
        className,
      )}
    />
  );
}

/** «2026-10» → «октябрь 2026». */
export function monthTitle(month: string): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(d)
    .replace(/\s*г\.?$/, "");
}

/** «2026-10» → «окт 26» — для заголовков сетки. */
export function monthShort(month: string): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));
  const m = new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" })
    .format(d)
    .replace(".", "");
  return `${m} ${month.slice(2, 4)}`;
}

/** Имя датасета для карточки: из стора; демо-датасет плана мог ещё не засидиться. */
export function datasetName(datasets: Dataset[], id: string): string {
  const ds = datasets.find((d) => d.id === id);
  if (ds) return ds.name;
  if (id === DEMO_PLAN_DATASET_ID) return "Демо: установки по дням";
  return "Датасет недоступен";
}

/** Колонки даты датасета (только date/datetime, включённые). */
export function dateColumnsOf(ds: Dataset | undefined): DatasetColumn[] {
  if (!ds) return [];
  return ds.columns.filter(
    (c) => c.enabled !== false && (c.datasetType === "date" || c.datasetType === "datetime"),
  );
}

/** Метрики датасета для поля плана: числовые колонки и вычисляемые поля. */
export function metricOptionsOf(
  ds: Dataset | undefined,
): Array<{ name: string; group: "column" | "calculated" }> {
  if (!ds) return [];
  const cols = ds.columns
    .filter((c) => c.enabled !== false && (c.datasetType === "integer" || c.datasetType === "float"))
    .map((c) => ({ name: c.name, group: "column" as const }));
  const calc = (ds.calculatedFields ?? []).map((c) => ({
    name: c.name,
    group: "calculated" as const,
  }));
  return [...cols, ...calc];
}

/** Подгрузить план-проекты при открытии страницы (StoreSync их не грузит); `load()` идемпотентен. */
export function useEnsurePlanLoaded(): void {
  const load = usePlanStore((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
