"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Calculator,
  Database,
  Eye,
  Filter,
  GitBranch,
  Loader2,
  Rows3,
  Shield,
  Sigma,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { InlineHelp } from "@/components/help/InlineHelp";
import type { Dataset } from "@/lib/types";
import type { AnonymizePreview } from "@/components/ai/ConfidentialityPanel";

interface Props {
  dataset: Dataset;
  /** Зоны конструктора (каждая — отдельная карточка). */
  groupingSlot: React.ReactNode;
  groupingCount: number;
  metricsSlot: React.ReactNode;
  metricsCount: number;
  calcSlot: React.ReactNode;
  calcCount: number;
  filtersSlot: React.ReactNode;
  filtersCount: number;
  /** Активна ли группировка (сводка) vs сырые строки — для подписи футера. */
  grouped: boolean;
  included: number;
  masked: number;
  cost: number;
  includeFunnel: boolean;
  onIncludeFunnelChange: (v: boolean) => void;
  /** Предпросмотр «что увидит AI» (тянет данные + зовёт /api/ai/anonymize-preview). */
  onPreview: () => Promise<AnonymizePreview>;
}

/** Карточка-зона конструктора с заголовком и (опц.) счётчиком. */
function Zone({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof Rows3;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 rounded-xl border border-border bg-card/40 p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function AiContextPanel({
  dataset,
  groupingSlot,
  groupingCount,
  metricsSlot,
  metricsCount,
  calcSlot,
  calcCount,
  filtersSlot,
  filtersCount,
  grouped,
  included,
  masked,
  cost,
  includeFunnel,
  onIncludeFunnelChange,
  onPreview,
}: Props) {
  const funnelSteps = [...(dataset.funnelSteps ?? [])].sort(
    (a, b) => a.order - b.order,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<AnonymizePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  async function runPreview() {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    try {
      setPreview(await onPreview());
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <div className="surface flex max-h-[70vh] w-full flex-col overflow-hidden lg:h-full lg:max-h-none lg:w-[340px] lg:shrink-0">
      {/* header */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-iris-bright">
          <Shield className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold">Конструктор анализа</div>
          <div className="font-mono text-[10px] text-faint">
            что отправляется в Claude
          </div>
        </div>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto p-4">
        <div className="mb-3">
          <InlineHelp title="Как это работает: что уходит в AI">
            <p>
              Здесь вы собираете «срез», который отправится модели:
            </p>
            <p>
              <b className="text-foreground">Группировка</b> — измерения (кампания,
              гео), по которым считается сводка.{" "}
              <b className="text-foreground">Метрики</b> — числа (расход, выручка) и
              как их сворачивать (сумма/среднее).{" "}
              <b className="text-foreground">Вычисляемые поля</b> — свои формулы
              (ARPU, ROI). <b className="text-foreground">Фильтры</b> — сужают
              данные перед отправкой.
            </p>
            <p>
              🔒 <b className="text-foreground">Маскировка:</b> у поля группировки
              нажмите глаз 👁 — оно станет замком 🔒, и его реальные значения
              заменятся кодами (AI их не увидит). Кнопка{" "}
              <b className="text-foreground">«Предпросмотр»</b> внизу показывает
              ровно то, что отправится.
            </p>
          </InlineHelp>
        </div>
        {/* датасет */}
        <Zone icon={Database} title="Датасет">
          <div className="flex items-center gap-2 rounded-lg border border-primary/60 bg-primary/10 px-3 py-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span className="truncate font-mono text-xs text-foreground">
              {dataset.name}
            </span>
          </div>
        </Zone>

        {/* 1. группировка (строки сводной таблицы) + маскировка */}
        <Zone icon={Rows3} title="Группировка" count={groupingCount}>
          {groupingSlot}
        </Zone>

        {/* 2. метрики (числовые показатели + агрегация) */}
        <Zone icon={Sigma} title="Метрики" count={metricsCount}>
          {metricsSlot}
        </Zone>

        {/* 3. вычисляемые поля (формулы с агрегатами) */}
        <Zone icon={Calculator} title="Вычисляемые поля" count={calcCount}>
          {calcSlot}
        </Zone>

        {/* 4. фильтры (отдельная зона) */}
        <Zone icon={Filter} title="Фильтры" count={filtersCount}>
          {filtersSlot}
        </Zone>

        {/* воронка — опциональный фоновый контекст */}
        {funnelSteps.length > 0 && (
          <Zone icon={GitBranch} title="Воронка">
            <div className="rounded-lg border border-border bg-muted px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-foreground">
                  Передавать в контекст AI
                </span>
                <Switch
                  checked={includeFunnel}
                  onCheckedChange={onIncludeFunnelChange}
                />
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-faint">
                Воронка — фоновый контекст, а не команда. По умолчанию выключена,
                чтобы не сбивать ответ с вашего вопроса.
              </p>
              {includeFunnel && (
                <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 font-mono text-[10.5px] text-muted-foreground">
                  {funnelSteps.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      <span className="rounded bg-accent px-1.5 py-0.5">
                        {s.label?.trim() || s.column}
                      </span>
                      {i < funnelSteps.length - 1 && (
                        <span className="text-faint">→</span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Zone>
        )}
      </div>

      {/* компактная сводка снизу + предпросмотр */}
      <div className="space-y-2 border-t border-border bg-popover p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-faint">
          <span>
            <b className="tabular-nums text-foreground">{included}</b>{" "}
            {grouped ? "полей в сводке" : "полей"}
          </span>
          <span>
            <b className="tabular-nums text-warning">{masked}</b> в маске
          </span>
          <span>
            <b className="tabular-nums text-spectrum-cyan">≤500</b> строк
          </span>
          <span className="text-success">~{formatCurrency(cost)}</span>
        </div>
        <button
          type="button"
          onClick={runPreview}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-hair-2 bg-card py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
        >
          <Eye className="h-3.5 w-3.5" /> Предпросмотр — что увидит AI
        </button>
      </div>

      {/* preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" /> Что увидит AI
            </DialogTitle>
            <DialogDescription>
              Данные и промпт ПОСЛЕ маскировки — именно это отправится в Claude.
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
              {preview.duplication && (
                <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Похоже на <b className="text-foreground">дубли строк</b> в
                    источнике: ~{preview.duplication.factor}× (из{" "}
                    {preview.duplication.total} строк уникальных только{" "}
                    {preview.duplication.distinct}). При группировке с{" "}
                    <span className="font-mono">SUM</span> суммы могут быть
                    завышены в ~{preview.duplication.factor} раз — проверьте
                    JOIN/GROUP BY в SQL датасета.
                  </p>
                </div>
              )}
              {preview.highCardinalityColumns.length > 0 && (
                <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Много уникальных значений в{" "}
                    <span className="font-mono text-foreground">
                      {preview.highCardinalityColumns.join(", ")}
                    </span>{" "}
                    (&gt;{preview.threshold}). Маскировка увеличит объём и стоимость.
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-foreground">
                  Данные (CSV), первые {preview.sampleSize} из {preview.totalRows}{" "}
                  строк
                </h4>
                <pre className="max-h-48 overflow-auto whitespace-pre rounded-md border border-border bg-muted/40 p-2.5 font-mono text-[11px] leading-snug text-muted-foreground">
                  {preview.maskedCsv || "—"}
                </pre>
              </div>
              {preview.maskedPrompt && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-foreground">
                    Промпт (после маскировки)
                  </h4>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2.5 font-mono text-[11px] leading-snug text-muted-foreground">
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
