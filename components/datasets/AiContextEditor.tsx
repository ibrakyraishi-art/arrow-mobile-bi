"use client";

import { useMemo } from "react";
import type {
  CalculatedField,
  DatasetColumn,
  FunnelStep,
} from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowDown,
  ArrowUp,
  Calculator,
  GitBranch,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

interface Props {
  businessContext: string;
  onBusinessContextChange: (value: string) => void;
  columns: DatasetColumn[];
  onColumnsChange: (next: DatasetColumn[]) => void;
  calculatedFields: CalculatedField[];
  onCalculatedFieldsChange: (next: CalculatedField[]) => void;
  funnelSteps: FunnelStep[];
  onFunnelStepsChange: (next: FunnelStep[]) => void;
}

const COLUMN_CONTEXT_PLACEHOLDERS: Record<string, string> = {
  cost: "Базовый дневной расход $50–200. Свыше $500 — high-budget.",
  spend: "Базовый дневной расход $50–200. Свыше $500 — high-budget.",
  installs: "Целевой CPI < $3. При расходе $50+ ожидаем 15+ installs.",
};

const DEFAULT_CONTEXT_PLACEHOLDER =
  "Что означает столбец, что считать нормой и аномалией для AI.";

/** Готовый образец «описания бизнеса» — вставляется в пустое поле по кнопке. */
const BUSINESS_CONTEXT_EXAMPLE =
  "Мобильная игра, гео US/EU, iOS+Android. Монетизация: реклама + встроенные " +
  "покупки. Трафик льём через Meta, Google UAC, TikTok. Ключевые KPI: ROAS D7 " +
  "≥ 1.0, CPI ≤ $2.5, удержание D1 ≥ 35%. Сезонность: пик в декабре. Аномалия " +
  "— рост spend без installs (риск фрода).";

function isMeasureColumn(c: DatasetColumn): boolean {
  return c.datasetType === "integer" || c.datasetType === "float";
}

function funnelStepLabel(
  columnName: string,
  funnelSteps: FunnelStep[],
): string | null {
  const ordered = [...funnelSteps].sort((a, b) => a.order - b.order);
  const idx = ordered.findIndex((s) => s.column === columnName);
  if (idx === -1) return null;
  const s = ordered[idx];
  const title = s.label?.trim() ? ` — ${s.label.trim()}` : "";
  return `Воронка: шаг ${idx + 1}${title}`;
}

export function AiContextEditor({
  businessContext,
  onBusinessContextChange,
  columns,
  onColumnsChange,
  calculatedFields,
  onCalculatedFieldsChange,
  funnelSteps,
  onFunnelStepsChange,
}: Props) {
  const enabledColumns = useMemo(
    () => columns.filter((c) => c.enabled),
    [columns],
  );

  const measureOptions = useMemo(() => {
    const fromColumns = enabledColumns
      .filter(isMeasureColumn)
      .map((c) => ({ name: c.name, isCalculated: false }));
    const fromCalc = calculatedFields
      .filter((f) => f.name.trim().length > 0)
      .map((f) => ({ name: f.name, isCalculated: true }));
    return [...fromColumns, ...fromCalc];
  }, [enabledColumns, calculatedFields]);

  const updateColumnContext = (name: string, businessContext: string) => {
    onColumnsChange(
      columns.map((c) => (c.name === name ? { ...c, businessContext } : c)),
    );
  };

  const updateCalcAi = (id: string, aiDescription: string) => {
    onCalculatedFieldsChange(
      calculatedFields.map((f) => (f.id === id ? { ...f, aiDescription } : f)),
    );
  };

  const addFunnelStep = () => {
    if (measureOptions.length === 0) return;
    const firstMeasure = measureOptions[0];
    const order =
      funnelSteps.length === 0
        ? 0
        : Math.max(...funnelSteps.map((s) => s.order)) + 1;
    onFunnelStepsChange([
      ...funnelSteps,
      { column: firstMeasure.name, label: "", order },
    ]);
  };

  const updateFunnelStep = (idx: number, patch: Partial<FunnelStep>) => {
    const next = funnelSteps.slice();
    next[idx] = { ...next[idx], ...patch };
    onFunnelStepsChange(next);
  };

  const removeFunnelStep = (idx: number) => {
    const next = funnelSteps
      .filter((_, i) => i !== idx)
      .map((s, i) => ({ ...s, order: i }));
    onFunnelStepsChange(next);
  };

  const moveFunnelStep = (idx: number, direction: -1 | 1) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= funnelSteps.length) return;
    const next = funnelSteps.slice();
    [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
    onFunnelStepsChange(next.map((s, i) => ({ ...s, order: i })));
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <Label
          htmlFor="business-context"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <Sparkles className="h-4 w-4 text-primary" />
          Описание бизнеса / источника данных
        </Label>
        <p className="text-xs text-muted-foreground">
          Главный контекст для AI: этот текст уходит в Claude при каждом анализе
          (и в уведомлениях). Чем конкретнее — тем точнее выводы.
        </p>
        <Textarea
          id="business-context"
          value={businessContext}
          onChange={(e) => onBusinessContextChange(e.target.value)}
          placeholder="Клиент, продукт, гео, модель монетизации, ключевые KPI, нормы и аномалии. Например: «Мобильная игра, гео US/EU… ROAS D7 ≥ 1.0, CPI ≤ $2.5»."
          className="min-h-[120px] text-sm"
        />

        {/* Плашка-пример: показывает, что именно писать. Кнопка «Вставить
            пример» появляется только когда поле пустое — чтобы не затереть
            уже введённый текст. */}
        <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-primary/80">
              Пример заполнения
            </span>
            {!businessContext.trim() && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-primary hover:bg-primary/10"
                onClick={() => onBusinessContextChange(BUSINESS_CONTEXT_EXAMPLE)}
              >
                Вставить пример
              </Button>
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {BUSINESS_CONTEXT_EXAMPLE}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Столбцы: контекст для AI</h3>
          <Badge variant="outline" className="text-[10px]">
            {enabledColumns.length + calculatedFields.length}
          </Badge>
        </div>

        {enabledColumns.length === 0 && calculatedFields.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            Сначала включите столбцы и/или добавьте вычисляемые поля.
          </div>
        ) : (
          <div className="space-y-2">
            {enabledColumns.map((col) => {
              const isMeasure = isMeasureColumn(col);
              const funnel = funnelStepLabel(col.name, funnelSteps);
              const placeholder =
                COLUMN_CONTEXT_PLACEHOLDERS[col.name.toLowerCase()] ??
                DEFAULT_CONTEXT_PLACEHOLDER;
              return (
                <div
                  key={col.name}
                  className="space-y-1.5 rounded-md border border-border bg-card/40 p-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className="font-mono text-[10px] shrink-0"
                    >
                      {col.name}
                    </Badge>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {isMeasure ? "мера" : "измерение"}
                    </span>
                    {funnel ? (
                      <span className="text-[10px] text-muted-foreground">
                        {funnel}
                      </span>
                    ) : null}
                  </div>
                  <Textarea
                    value={col.businessContext ?? ""}
                    onChange={(e) =>
                      updateColumnContext(col.name, e.target.value)
                    }
                    placeholder={placeholder}
                    rows={2}
                    className="min-h-[52px] resize-y text-xs leading-snug"
                  />
                </div>
              );
            })}

            {calculatedFields.map((f) => (
              <div
                key={f.id}
                className="space-y-1.5 rounded-md border border-border bg-card/40 p-2.5"
              >
                <div className="flex items-center gap-2">
                  <Calculator className="h-3.5 w-3.5 text-primary" />
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px] shrink-0"
                  >
                    {f.name || "без имени"}
                  </Badge>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    вычисляемое поле
                  </span>
                </div>
                <Textarea
                  value={f.aiDescription ?? ""}
                  onChange={(e) => updateCalcAi(f.id, e.target.value)}
                  placeholder="Что измеряет формула? Какие значения считать хорошими?"
                  rows={2}
                  className="min-h-[52px] resize-y text-xs leading-snug"
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">Воронка</h3>
          <Badge variant="outline" className="text-[10px]">
            {funnelSteps.length}
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Выстройте меры в порядке воронки — AI будет использовать это для
          анализа конверсий между этапами.
        </p>

        {funnelSteps.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            Воронка пока не настроена. Добавьте первый этап.
          </div>
        )}

        {funnelSteps.map((step, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 rounded-md border border-border bg-card/40 p-2"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
              {idx + 1}
            </div>

            <Select
              value={step.column}
              onValueChange={(v) => updateFunnelStep(idx, { column: v })}
              disabled={measureOptions.length === 0}
            >
              <SelectTrigger className="h-8 w-[200px] text-xs font-mono">
                <SelectValue placeholder="Мера" />
              </SelectTrigger>
              <SelectContent>
                {measureOptions.map((m) => (
                  <SelectItem key={m.name} value={m.name}>
                    <span className="flex items-center gap-1.5">
                      {m.isCalculated && (
                        <Calculator className="h-3 w-3 text-primary" />
                      )}
                      <span className="font-mono text-xs">{m.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              value={step.label}
              onChange={(e) => updateFunnelStep(idx, { label: e.target.value })}
              placeholder="Название этапа"
              className="h-8 flex-1 text-xs"
            />

            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => moveFunnelStep(idx, -1)}
                disabled={idx === 0}
                aria-label="Выше"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => moveFunnelStep(idx, 1)}
                disabled={idx === funnelSteps.length - 1}
                aria-label="Ниже"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => removeFunnelStep(idx)}
                aria-label="Удалить этап"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          className="w-full border-dashed"
          onClick={addFunnelStep}
          disabled={measureOptions.length === 0}
        >
          <Plus className="h-4 w-4" />
          {measureOptions.length === 0
            ? "Нет доступных мер"
            : "Добавить этап"}
        </Button>
      </section>
    </div>
  );
}
