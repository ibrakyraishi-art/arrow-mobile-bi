"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PlanStep {
  key: string;
  title: string;
  hint: string;
  done: boolean;
}

/**
 * Пошаговая подсказка «Датасет → Дата → Поля → План → Дашборд» (история 34).
 * Шаги отмечаются по факту заполнения; текущий — первый невыполненный.
 */
export function PlanSteps({ steps }: { steps: PlanStep[] }) {
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5">
      {steps.map((s, i) => {
        const isCurrent = i === current;
        return (
          <li
            key={s.key}
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "flex items-start gap-2.5 rounded-md border px-3 py-2",
              s.done
                ? "border-ok/40 bg-ok/5"
                : isCurrent
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                s.done
                  ? "bg-ok text-background"
                  : isCurrent
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {s.done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{s.title}</span>
              <span className="block text-[11px] leading-snug text-muted-foreground">{s.hint}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
