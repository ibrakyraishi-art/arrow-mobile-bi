"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Eye,
  Lock,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Dataset } from "@/lib/types";

export interface AnonymizePreview {
  maskedCsv: string;
  maskedPrompt: string;
  cardinalities: Record<string, number>;
  highCardinalityColumns: string[];
  threshold: number;
  totalRows: number;
  sampleSize: number;
  /**
   * Диагностика дублей строк в источнике (когда включена группировка). Если
   * строки повторяются — суммы в сводной таблице могут быть завышены в `factor`×.
   */
  duplication?: { factor: number; total: number; distinct: number } | null;
}

interface Props {
  dataset: Dataset;
  /** Выбранные конфиденциальные столбцы. */
  value: string[];
  onChange: (columns: string[]) => void;
  /** Парент тянет данные (с фильтрами) и зовёт /api/ai/anonymize-preview. */
  onPreview: () => Promise<AnonymizePreview>;
  disabled?: boolean;
}

/** Столбцы, которые имеет смысл маскировать: текстовые/категориальные. */
function isMaskable(type: string): boolean {
  return type === "string" || type === "category";
}

export function ConfidentialityPanel({
  dataset,
  value,
  onChange,
  onPreview,
  disabled,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<AnonymizePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const selected = useMemo(() => new Set(value), [value]);
  const enabled = value.length > 0;

  // Столбцы-кандидаты: маскируемые по типу + уже выбранные (на случай, если
  // тип столбца поменяли после выбора — чтобы можно было снять отметку).
  const maskableColumns = useMemo(() => {
    const eligible = dataset.columns
      .filter((c) => c.enabled && isMaskable(c.datasetType))
      .map((c) => ({ name: c.name, type: c.datasetType }));
    const extra = value
      .filter((name) => !eligible.some((c) => c.name === name))
      .map((name) => {
        const col = dataset.columns.find((c) => c.name === name);
        return { name, type: col?.datasetType ?? "string" };
      });
    return [...eligible, ...extra];
  }, [dataset.columns, value]);

  function toggle(name: string) {
    if (selected.has(name)) {
      onChange(value.filter((c) => c !== name));
    } else {
      onChange([...value, name]);
    }
  }

  async function runPreview() {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const res = await onPreview();
      setPreview(res);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Конфиденциальность (NDA)
          </h3>
          {enabled ? (
            <Badge variant="success" className="gap-1 text-[10px]">
              <ShieldCheck className="h-3 w-3" /> ВКЛ
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              ВЫКЛ
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={disabled}
              >
                <Lock className="h-3.5 w-3.5" />
                {value.length === 0
                  ? "Отметить столбцы"
                  : `${value.length} скрыто`}
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[320px] p-0">
              <div className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
                Отметьте столбцы с реальными названиями (источник, кампания,
                креатив, гео). Числовые метрики маскировать не нужно.
              </div>
              <div className="max-h-[260px] overflow-y-auto p-1">
                {maskableColumns.length === 0 ? (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                    Нет текстовых столбцов для маскировки
                  </div>
                ) : (
                  maskableColumns.map((c) => {
                    const checked = selected.has(c.name);
                    return (
                      <button
                        key={c.name}
                        type="button"
                        onClick={() => toggle(c.name)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
                          checked && "bg-accent/60",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                              checked
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border",
                            )}
                          >
                            {checked && <Check className="h-3 w-3" />}
                          </span>
                          {checked && <Lock className="h-3 w-3 text-warning" />}
                          <span className="truncate font-mono">{c.name}</span>
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {c.type}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={runPreview}
            disabled={disabled || !enabled}
            title="Показать, что именно увидит AI"
          >
            <Eye className="h-3.5 w-3.5" />
            Предпросмотр
          </Button>
        </div>
      </div>

      {/* Чипы выбранных столбцов */}
      {enabled && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 font-mono text-[11px] text-foreground"
            >
              <Lock className="h-3 w-3 text-warning" />
              {name}
              <button
                type="button"
                onClick={() => toggle(name)}
                className="ml-0.5 text-muted-foreground hover:text-foreground"
                aria-label={`Убрать ${name} из конфиденциальных`}
                disabled={disabled}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Пояснение / предупреждение */}
      {enabled ? (
        <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/5 p-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Значения отмеченных столбцов заменяются на коды (напр.{" "}
            <span className="font-mono">SRC_01</span>) перед отправкой в AI и
            восстанавливаются в ответе — Claude не видит реальных названий.{" "}
            <span className="text-foreground">
              Старайтесь не упоминать реальные названия в своём промпте
            </span>{" "}
            — но если упомянёте, мы постараемся скрыть их автоматически.
            Нажмите «Предпросмотр», чтобы убедиться, что всё скрыто.
          </p>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Режим выключен — данные уходят в AI как есть. Отметьте столбцы с
          реальными названиями клиента, чтобы скрыть их от Claude (для NDA).
        </p>
      )}

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" /> Что увидит AI
            </DialogTitle>
            <DialogDescription>
              Так выглядят данные и промпт ПОСЛЕ маскировки — именно это
              отправится в Claude. Реальных названий здесь быть не должно.
            </DialogDescription>
          </DialogHeader>

          {previewLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Готовим предпросмотр…
            </div>
          ) : previewError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {previewError}
            </div>
          ) : preview ? (
            <div className="space-y-4">
              {preview.highCardinalityColumns.length > 0 && (
                <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Много уникальных значений в:{" "}
                    <span className="font-mono text-foreground">
                      {preview.highCardinalityColumns.join(", ")}
                    </span>{" "}
                    (&gt;{preview.threshold}). Маскировка увеличит объём данных и
                    стоимость, а качество анализа может снизиться.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-foreground">
                    Данные (CSV), первые {preview.sampleSize} из{" "}
                    {preview.totalRows} строк
                  </h4>
                  <span className="text-[10px] text-muted-foreground">
                    {Object.entries(preview.cardinalities)
                      .map(([c, n]) => `${c}: ${n}`)
                      .join(" · ")}
                  </span>
                </div>
                <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/20 p-2.5 font-mono text-[11px] leading-snug whitespace-pre text-muted-foreground">
                  {preview.maskedCsv || "—"}
                </pre>
              </div>

              {preview.maskedPrompt && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-foreground">
                    Промпт (после маскировки)
                  </h4>
                  <pre className="max-h-32 overflow-auto rounded-md border border-border bg-muted/20 p-2.5 font-mono text-[11px] leading-snug whitespace-pre-wrap text-muted-foreground">
                    {preview.maskedPrompt}
                  </pre>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
