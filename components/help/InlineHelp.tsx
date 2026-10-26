"use client";

import type { ReactNode } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";

/**
 * Компактная инлайн-справка «прямо в функции»: видимая плашка, которую можно
 * раскрыть и прочитать, как работает конкретная функция (типы столбцов,
 * контекст, маскировка и т.п.). Нативный <details> — доступно с клавиатуры,
 * без состояния. Ставится рядом с самой функцией (в отличие от TabIntro —
 * общей инструкции вкладки сверху).
 */
export function InlineHelp({
  title = "Как это работает",
  children,
  defaultOpen = false,
}: {
  title?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      {...(defaultOpen ? { open: true } : {})}
      className="group rounded-lg border border-primary/25 bg-primary/[0.04]"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[13px] font-medium text-primary [&::-webkit-details-marker]:hidden">
        <HelpCircle className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{title}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-2 border-t border-primary/15 px-3 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}
