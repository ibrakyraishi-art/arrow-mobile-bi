"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Loader2,
  RefreshCw,
  Table2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TableColumn {
  key: string;
  label: string;
  isDim: boolean;
}
interface PivotTableData {
  columns: TableColumn[];
  rows: string[][];
  totalRows: number;
  totalWidth: number;
  tooWide: boolean;
}
interface PreviewResult {
  status: "ok" | "error" | "no_match";
  matchedCount: number;
  table?: string;
  tableData?: PivotTableData;
  errorText?: string;
  /** Пояснение для пустого результата (например, данные вне периода). */
  message?: string;
}

/** Сколько строк показываем в превью по умолчанию (остальные — «…ещё N»). */
const PREVIEW_ROWS = 15;

/**
 * Живое превью сводной таблицы: дебаунс-запрос к /api/alert-rules/preview
 * (dry-run) при изменении настроек конструктора. Рендерит интерактивную
 * таблицу (клик по заголовку — сортировка, прилипающая шапка, ~15 строк,
 * предупреждение о ширине для Telegram). Не падает на пустых данных.
 */
export function LiveTablePreview({
  signature,
  buildPayload,
}: {
  signature: string;
  buildPayload: () => Record<string, unknown> | null;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  // Клиентская сортировка превью (не влияет на правило — только на показ).
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const payload = buildPayload();
    if (!payload) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/alert-rules/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? `HTTP ${res.status}`);
          setResult(null);
        } else {
          setResult(json.result as PreviewResult);
          // Новый расчёт — сбрасываем клиентскую сортировку/разворот.
          setSortCol(null);
          setShowAll(false);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, nonce]);

  const data = result?.tableData;

  // Клиентская сортировка строк по выбранной колонке (числа — по величине).
  const sortedRows = useMemo(() => {
    if (!data) return [];
    if (sortCol === null) return data.rows;
    const isDim = data.columns[sortCol]?.isDim ?? true;
    const dir = sortDir === "asc" ? 1 : -1;
    const parseNum = (s: string) => {
      // «$1 234.56», «12.5%» → число; «—»/текст → NaN
      const n = Number(s.replace(/[^0-9.,-]/g, "").replace(/\s/g, "").replace(",", "."));
      return Number.isFinite(n) ? n : NaN;
    };
    return data.rows.slice().sort((ra, rb) => {
      const a = ra[sortCol] ?? "";
      const b = rb[sortCol] ?? "";
      const aEmpty = a === "" || a === "—";
      const bEmpty = b === "" || b === "—";
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (!isDim) {
        const an = parseNum(a);
        const bn = parseNum(b);
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir;
      }
      return a.localeCompare(b, "ru") * dir;
    });
  }, [data, sortCol, sortDir]);

  const visibleRows = showAll ? sortedRows : sortedRows.slice(0, PREVIEW_ROWS);
  const hiddenCount = sortedRows.length - visibleRows.length;

  function onHeaderClick(i: number) {
    if (sortCol === i) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(i);
      setSortDir("asc");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Table2 className="h-3.5 w-3.5" />
          Так таблица уйдёт в Telegram (обновляется автоматически).
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setNonce((n) => n + 1)}
          disabled={loading}
        >
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Обновить
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {!error && loading && !result && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Считаю таблицу…
        </div>
      )}

      {!error && result && result.status === "error" && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {result.errorText ?? "Ошибка"}
        </div>
      )}

      {!error && result && result.status === "no_match" && (
        <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          {result.message?.trim() ||
            "Нет строк по текущим настройкам — таблица будет пустой."}
        </div>
      )}

      {!error && result && result.status === "ok" && data && (
        <div className={cn(loading && "opacity-50 transition-opacity")}>
          <div className="text-[11px] text-muted-foreground">
            Всего строк: <span className="font-mono">{result.matchedCount}</span>
            {" · "}клик по заголовку — сортировка превью
            {loading && " · обновляю…"}
          </div>

          {data.tooWide && (
            <div className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Таблица широкая (~{data.totalWidth} символов) — в Telegram на
                телефоне строки могут переноситься. Уберите часть колонок
                (метрик), чтобы было ≲34 символов.
              </span>
            </div>
          )}

          <div className="max-h-72 overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse font-mono text-[11px]">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr>
                  {data.columns.map((c, i) => {
                    const activeSort = sortCol === i;
                    return (
                      <th
                        key={c.key}
                        onClick={() => onHeaderClick(i)}
                        className={cn(
                          "cursor-pointer select-none whitespace-nowrap border-b border-border px-2 py-1.5",
                          c.isDim ? "text-left" : "text-right",
                          "hover:bg-accent",
                        )}
                        title="Клик — сортировать по этой колонке"
                      >
                        <span
                          className={cn(
                            "inline-flex items-center gap-1",
                            !c.isDim && "flex-row-reverse",
                          )}
                        >
                          {c.label}
                          {activeSort ? (
                            sortDir === "asc" ? (
                              <ArrowUp className="h-3 w-3 text-brand-500" />
                            ) : (
                              <ArrowDown className="h-3 w-3 text-brand-500" />
                            )
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-30" />
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, ri) => (
                  <tr key={ri} className="even:bg-muted/20">
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={cn(
                          "whitespace-nowrap px-2 py-1",
                          data.columns[ci]?.isDim
                            ? "text-left"
                            : "text-right tabular-nums",
                        )}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="text-[11px] font-medium text-brand-500 hover:text-brand-400"
            >
              …ещё {hiddenCount}{" "}
              {hiddenCount === 1 ? "строка" : "строк"} — показать все
            </button>
          )}
          {showAll && sortedRows.length > PREVIEW_ROWS && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Свернуть
            </button>
          )}
        </div>
      )}

      {/* Фоллбэк: если структурных данных нет, но текст есть (старый формат). */}
      {!error &&
        result &&
        result.status === "ok" &&
        !data &&
        result.table &&
        result.table.trim().length > 0 && (
          <pre className="max-h-72 overflow-auto whitespace-pre rounded-md border border-border bg-muted/30 p-3 font-mono text-[11px] leading-snug text-foreground">
            {result.table}
          </pre>
        )}
    </div>
  );
}
