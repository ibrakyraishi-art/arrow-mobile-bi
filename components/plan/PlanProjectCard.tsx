"use client";

import Link from "next/link";
import { Database, Loader2, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PlanProject } from "@/lib/types";
import { cn } from "@/lib/utils";
import { usePlanSummary } from "./summary";
import { formatCompletionPercent, trafficLightLabel } from "@/lib/plan";
import { LightDot, lightText, monthTitle } from "./plan-ui";

interface Props {
  project: PlanProject;
  datasetName: string;
  /** Текущий месяц `YYYY-MM` (по Москве). */
  month: string;
}

/** Карточка план-проекта: имя, датасет, выполнение главного поля за текущий месяц (история 18). */
export function PlanProjectCard({ project, datasetName, month }: Props) {
  const hasFields = project.fields.length > 0;
  const { data, loading, error } = usePlanSummary(hasFields ? project.id : null, month);
  const main = [...project.fields].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  const mainSummary = main ? data?.fields.find((f) => f.fieldId === main.id) : undefined;
  const updated = new Date(project.updatedAt);

  return (
    <Link
      href={`/plan/${project.id}`}
      className="group flex flex-col overflow-hidden rounded-md border border-border bg-card transition-colors hover:border-foreground/40"
    >
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 shrink-0 text-primary" />
            <h3 className="truncate text-base font-semibold">{project.name}</h3>
            {project.isDemo && <Badge variant="secondary">демо</Badge>}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Database className="h-3.5 w-3.5" />
            <span className="truncate">{datasetName}</span>
          </div>
        </div>
      </div>

      <div className="tile-gradient mx-4 flex items-end justify-between gap-3 rounded-sm px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-[11px] opacity-80">
            {main ? `${main.label} · ${monthTitle(month)}` : "Поля плана не заданы"}
          </div>
          <div className="text-3xl font-bold tabular-nums leading-tight">
            {!hasFields ? "—" : loading && !data ? (
              <Loader2 className="my-1.5 h-6 w-6 animate-spin" />
            ) : (
              formatCompletionPercent(
                typeof mainSummary?.completion === "number" ? mainSummary.completion * 100 : null,
              )
            )}
          </div>
        </div>
        {hasFields && !loading && (
          <span className="mb-1 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-card px-2 py-0.5 text-[11px] font-medium">
            <LightDot light={mainSummary?.light ?? null} />
            <span className={lightText(mainSummary?.light)}>
              {error
                ? "нет отчёта"
                : mainSummary?.light
                  ? trafficLightLabel(mainSummary.light, mainSummary.direction)
                  : mainSummary?.plan === null
                    ? "нет плана"
                    : "нет данных"}
            </span>
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 px-4 py-3 text-[11px] text-muted-foreground">
        <span>
          {project.fields.length} {plural(project.fields.length, "поле", "поля", "полей")} плана
        </span>
        <span className={cn(Number.isNaN(updated.getTime()) && "hidden")}>
          изменён {updated.toLocaleDateString("ru-RU")}
        </span>
      </div>
      {error && (
        <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground" title={error}>
          Отчёт недоступен: {error}
        </div>
      )}
    </Link>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
