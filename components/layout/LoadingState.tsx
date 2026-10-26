"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * Явная индикация загрузки: спиннер + подпись, плюс «дольше обычного» через
 * несколько секунд — чтобы при медленном первом ответе (БД «просыпается»,
 * латентность РФ→EU) пользователь видел, что идёт работа, а не зависание.
 */
export function LoadingState({
  label = "Загружаем данные…",
  slowAfterMs = 6000,
}: {
  label?: string;
  slowAfterMs?: number;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), slowAfterMs);
    return () => clearTimeout(t);
  }, [slowAfterMs]);

  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/10 py-12 text-center">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
      <div className="text-sm text-muted-foreground">{label}</div>
      {slow && (
        <div className="max-w-sm text-xs text-faint">
          Дольше обычного — похоже, база «просыпается» после простоя. Ещё пару
          секунд, не перезагружайте страницу.
        </div>
      )}
    </div>
  );
}
