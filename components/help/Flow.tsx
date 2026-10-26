import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "default" | "primary" | "success" | "warn" | "danger";

const TONE: Record<Tone, string> = {
  default: "border-border bg-card",
  primary: "border-primary/40 bg-primary/10",
  success: "border-success/40 bg-success/10",
  warn: "border-warning/40 bg-warning/10",
  danger: "border-destructive/40 bg-destructive/10",
};

export interface FlowStep {
  icon?: ReactNode;
  label: string;
  sub?: string;
  tone?: Tone;
}

/**
 * Простая схема-«поток»: коробочки со стрелками между ними (переносится на
 * узких экранах). Чисто презентационная — для наглядных схем в Справке и
 * инлайн-подсказках (без картинок-файлов).
 */
export function Flow({ steps }: { steps: FlowStep[] }) {
  return (
    <div className="flex flex-wrap items-stretch gap-1.5">
      {steps.map((s, i) => (
        <div key={i} className="flex items-stretch gap-1.5">
          <div
            className={cn(
              "flex min-w-[96px] max-w-[150px] flex-col items-center justify-center gap-1 rounded-lg border px-2.5 py-2 text-center",
              TONE[s.tone ?? "default"],
            )}
          >
            {s.icon ? <span className="text-foreground">{s.icon}</span> : null}
            <span className="text-[11px] font-semibold leading-tight text-foreground">
              {s.label}
            </span>
            {s.sub ? (
              <span className="text-[10px] leading-tight text-muted-foreground">
                {s.sub}
              </span>
            ) : null}
          </div>
          {i < steps.length - 1 ? (
            <ArrowRight className="h-4 w-4 shrink-0 self-center text-muted-foreground" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Две колонки «храним / не храним» (или любое да/нет-сравнение) — наглядно
 * показать, что остаётся у нас, а что нет.
 */
export function KeepDrop({
  keepTitle,
  keep,
  dropTitle,
  drop,
}: {
  keepTitle: string;
  keep: string[];
  dropTitle: string;
  drop: string[];
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="rounded-lg border border-success/40 bg-success/[0.06] p-3">
        <div className="mb-1.5 text-xs font-semibold text-success">{keepTitle}</div>
        <ul className="space-y-1 text-[12px] text-muted-foreground">
          {keep.map((k) => (
            <li key={k} className="flex gap-1.5">
              <span className="text-success">✓</span>
              <span>{k}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-lg border border-destructive/40 bg-destructive/[0.06] p-3">
        <div className="mb-1.5 text-xs font-semibold text-destructive">
          {dropTitle}
        </div>
        <ul className="space-y-1 text-[12px] text-muted-foreground">
          {drop.map((d) => (
            <li key={d} className="flex gap-1.5">
              <span className="text-destructive">✗</span>
              <span>{d}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
