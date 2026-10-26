"use client";

import { ChevronDown, FlaskConical, Info } from "lucide-react";

interface Point {
  title: string;
  text: string;
}

interface Props {
  /** Короткая строка-подсказка (видна в свёрнутом виде). */
  lead: string;
  /** Пункты «как работает / для чего» (раскрываются). */
  points: Point[];
  title?: string;
  /** Показать плашку «Бета · возможны косяки» над инструкцией. */
  beta?: boolean;
  /** Доп. текст к бете (например, «Полностью готова 15–21 июня»). */
  betaNote?: string;
}

/**
 * Раскрывающаяся инструкция вкладки: «что это и как работает». Свёрнута по
 * умолчанию, на видном месте сверху страницы. Нативный <details> — доступно с
 * клавиатуры, без зависимостей. Используется на всех вкладках.
 */
export function TabIntro({
  lead,
  points,
  title = "Как работает эта вкладка",
  beta = false,
  betaNote,
}: Props) {
  return (
    <>
      {beta && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <FlaskConical className="h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-semibold">Бета</span> · вкладка в разработке,
            возможны косяки.{betaNote ? ` ${betaNote}` : ""}
          </span>
        </div>
      )}
      <details className="group mb-5 rounded-xl border border-border bg-secondary/40">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Info className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">{title}</span>
          <span className="block text-xs text-muted-foreground">{lead}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-2.5 border-t border-border px-4 pb-4 pt-3">
        {points.map((p) => (
          <div key={p.title} className="flex gap-2.5 text-sm">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <p className="leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">{p.title}.</span>{" "}
              {p.text}
            </p>
          </div>
        ))}
      </div>
      </details>
    </>
  );
}
