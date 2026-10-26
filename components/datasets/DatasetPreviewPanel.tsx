"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalculatedField, DatasetColumn } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  RotateCw,
  Sigma,
  Table as TableIcon,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { formatCalculatedValue } from "@/lib/format-value";
import { DATASET_TYPE_LABELS } from "@/lib/type-mapping";

interface PreviewColumn {
  name: string;
  type: string;
  isCalculated?: boolean;
}

interface PreviewResponse {
  rows: Record<string, unknown>[];
  columns: PreviewColumn[];
  rowCount: number;
  /** Агрегаты, не понижаемые до row-level (ячейки пустые). Сейчас всегда []. */
  aggregateFieldNames: string[];
  /** Aggregate-поля, показанные в превью построчно (раскрыто внутреннее выражение). */
  rowFallbackFieldNames: string[];
}

const AGG_ROW_TOOLTIP =
  "Это агрегатное поле (SUM/AVG/...). В превью показано по каждой строке без агрегации — чтобы быстро увидеть данные. В визуализациях с группировкой посчитается полноценный SUM по группе.";

interface Props {
  dataSourceId: string;
  table: string | null;
  sqlQuery: string | null;
  isDemo: boolean;
  calculatedFields: CalculatedField[];
  /** Метаданные колонок датасета — для типов сырых колонок и форматирования. */
  columns: DatasetColumn[];
}

const LS_KEY = "datasetPreviewPanel.collapsed";
const HEADER_H = 40;

export function DatasetPreviewPanel({
  dataSourceId,
  table,
  sqlQuery,
  isDemo,
  calculatedFields,
  columns,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedReady, setCollapsedReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PreviewResponse | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Восстанавливаем свёрнуто/развёрнуто из localStorage (по умолчанию развёрнуто).
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(LS_KEY) === "1");
    } catch {
      /* ignore */
    }
    setCollapsedReady(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LS_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const calcFieldByName = useMemo(() => {
    const m = new Map<string, CalculatedField>();
    for (const f of calculatedFields) m.set(f.name, f);
    return m;
  }, [calculatedFields]);

  const datasetTypeByName = useMemo(() => {
    const m = new Map<string, DatasetColumn["datasetType"]>();
    for (const c of columns) m.set(c.name, c.datasetType);
    return m;
  }, [columns]);

  const fetchPreview = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dataset/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataSourceId,
          table,
          sqlQuery,
          isDemo,
          calculatedFields,
        }),
        signal: controller.signal,
      });
      const body = (await res.json()) as PreviewResponse & { error?: string };
      if (!res.ok || body.error) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setData({
        rows: body.rows ?? [],
        columns: body.columns ?? [],
        rowCount: body.rowCount ?? (body.rows?.length ?? 0),
        aggregateFieldNames: body.aggregateFieldNames ?? [],
        rowFallbackFieldNames: body.rowFallbackFieldNames ?? [],
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }, [dataSourceId, table, sqlQuery, isDemo, calculatedFields]);

  // Debounce 500мс: при изменении calc-полей / источника / таблицы
  // перезапрашиваем превью.
  const deps = JSON.stringify({
    dataSourceId,
    table,
    sqlQuery,
    isDemo,
    fields: calculatedFields.map((f) => ({
      n: f.name,
      f: f.formula,
      t: f.datasetType,
    })),
  });
  useEffect(() => {
    const t = setTimeout(() => void fetchPreview(), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Агрегаты, не понижаемые до row-level → ячейки пустые (сейчас всегда пусто).
  const aggregateSet = useMemo(
    () => new Set(data?.aggregateFieldNames ?? []),
    [data?.aggregateFieldNames],
  );
  // Aggregate-поля, показанные построчно (раскрыто внутреннее выражение).
  const rowFallbackSet = useMemo(
    () => new Set(data?.rowFallbackFieldNames ?? []),
    [data?.rowFallbackFieldNames],
  );

  const renderCell = (col: PreviewColumn, raw: unknown) => {
    if (col.isCalculated && aggregateSet.has(col.name)) {
      return <span className="text-muted-foreground/40">—</span>;
    }
    if (raw === null || raw === undefined || raw === "") {
      return <span className="text-muted-foreground/50">—</span>;
    }
    // Вычисляемое (row-level) — форматируем по format поля.
    if (col.isCalculated) {
      const f = calcFieldByName.get(col.name);
      const num = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isNaN(num)) return formatCalculatedValue(num, f?.format);
      return String(raw);
    }
    const dt = datasetTypeByName.get(col.name);
    if (dt === "date" || dt === "datetime") {
      return formatDate(String(raw));
    }
    if ((dt === "integer" || dt === "float") && typeof raw !== "boolean") {
      const num = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isNaN(num)) {
        return new Intl.NumberFormat("ru-RU", {
          maximumFractionDigits: num % 1 === 0 ? 0 : 2,
        }).format(num);
      }
    }
    if (typeof raw === "boolean") return raw ? "true" : "false";
    return String(raw);
  };

  const typeLabel = (col: PreviewColumn): string => {
    if (col.isCalculated) {
      return col.type === "integer" ? "Целое" : "Дробное";
    }
    const dt = datasetTypeByName.get(col.name);
    if (dt) return DATASET_TYPE_LABELS[dt];
    return col.type || "—";
  };

  const isNumericCol = (col: PreviewColumn): boolean => {
    if (col.isCalculated) return !aggregateSet.has(col.name);
    const dt = datasetTypeByName.get(col.name);
    return dt === "integer" || dt === "float";
  };

  return (
    <div
      className={cn(
        "sticky bottom-0 z-30 -mx-6 lg:-mx-8 border-t border-border bg-card shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)]",
        // Скрываем пока не прочитали localStorage — чтобы не мигало.
        !collapsedReady && "invisible",
      )}
    >
      {/* Шапка */}
      <div
        className="flex items-center gap-2 px-4 cursor-pointer select-none"
        style={{ height: HEADER_H }}
        onClick={toggleCollapsed}
      >
        <TableIcon className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold text-foreground">
          Превью данных
        </span>
        <span className="text-xs text-muted-foreground">(50 строк)</span>
        {data && (
          <span className="rounded-md border border-border bg-secondary/50 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            {data.rowCount} {pluralRows(data.rowCount)}
          </span>
        )}
        {loading && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Обновление…
          </span>
        )}
        {error && !loading && (
          <span className="flex items-center gap-1 text-[11px] text-destructive">
            <AlertCircle className="h-3 w-3" />
            Ошибка
          </span>
        )}
        <span className="ml-auto" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            toggleCollapsed();
          }}
          aria-label={collapsed ? "Развернуть превью" : "Свернуть превью"}
          title={collapsed ? "Развернуть" : "Свернуть"}
        >
          {collapsed ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Тело */}
      {!collapsed && (
        <div className="h-[40vh] overflow-auto border-t border-border bg-card">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
              <div className="max-w-md text-sm text-destructive">{error}</div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void fetchPreview()}
              >
                <RotateCw className="h-3.5 w-3.5" />
                Повторить
              </Button>
            </div>
          ) : loading && !data ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-full opacity-70" />
              ))}
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Нет данных для превью
            </div>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-card">
                <tr>
                  {data.columns.map((col) => {
                    const isAggEmpty =
                      col.isCalculated && aggregateSet.has(col.name);
                    const isAggRow =
                      col.isCalculated && rowFallbackSet.has(col.name);
                    return (
                      <th
                        key={col.name}
                        className="whitespace-nowrap border-b border-border px-3 py-2 text-left font-medium"
                        title={
                          isAggRow
                            ? AGG_ROW_TOOLTIP
                            : isAggEmpty
                              ? "Агрегатное поле показывается только в визуализациях с группировкой"
                              : undefined
                        }
                      >
                        <div className="flex items-center gap-1.5">
                          {col.isCalculated && (
                            <span className="font-mono text-[9px] font-bold text-primary">
                              ƒx
                            </span>
                          )}
                          <span className="font-mono text-foreground">
                            {col.name}
                          </span>
                          {col.isCalculated &&
                            (isAggEmpty || isAggRow ? (
                              <>
                                <span className="inline-flex items-center gap-0.5 rounded border border-brand-500/40 bg-brand-500/10 px-1 text-[8px] font-mono font-bold uppercase tracking-wider text-brand-500">
                                  <Sigma className="h-2 w-2" />
                                  AGG
                                </span>
                                {isAggRow && (
                                  <span className="rounded border border-border bg-secondary/50 px-1 text-[8px] font-mono uppercase tracking-wider text-muted-foreground/80">
                                    по строке
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="rounded border border-border bg-secondary/50 px-1 text-[8px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
                                ROW
                              </span>
                            ))}
                          <span className="rounded border border-border bg-secondary/40 px-1 text-[8px] font-mono uppercase tracking-wider text-muted-foreground/70">
                            {typeLabel(col)}
                          </span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, ri) => (
                  <tr
                    key={ri}
                    className="border-b border-border/50 hover:bg-secondary/20"
                  >
                    {data.columns.map((col) => (
                      <td
                        key={col.name}
                        className={cn(
                          "whitespace-nowrap px-3 py-1.5",
                          isNumericCol(col)
                            ? "text-right font-mono tabular-nums"
                            : "",
                          col.isCalculated && "bg-primary/[0.04]",
                        )}
                      >
                        {renderCell(col, row[col.name])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function pluralRows(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "строк";
  if (mod10 === 1) return "строка";
  if (mod10 >= 2 && mod10 <= 4) return "строки";
  return "строк";
}
