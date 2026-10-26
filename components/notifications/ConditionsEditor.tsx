"use client";

import { useMemo } from "react";
import {
  Calculator,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  AlertCondition,
  AlertConditionOperator,
  AlertConditionPeriodChange,
  AlertConditionThreshold,
  AlertConditionTrend,
  AlertConditionVsGroupAvg,
  Dataset,
} from "@/lib/types";
import { MultiColumnPicker } from "./MultiColumnPicker";

const OPERATORS: AlertConditionOperator[] = [">", ">=", "<", "<=", "="];

type Kind = "threshold" | "period_change" | "vs_group_avg" | "trend";

const KIND_LABELS: Record<Kind, { label: string; hint: string }> = {
  threshold: {
    label: "Метрика выше/ниже числа",
    hint: "Например: расход за период больше 100 или подписок меньше 10.",
  },
  period_change: {
    label: "Резкое изменение",
    hint: "Сравнивает короткий период с длинным: например, последние 3 дня против 7 дней.",
  },
  vs_group_avg: {
    label: "Хуже/лучше среднего",
    hint: "Сравнивает объект со средним внутри выбранной группы, например channel + GEO.",
  },
  trend: {
    label: "Тренд ухудшается/улучшается",
    hint: "То же сравнение периодов, но с понятным выбором направления.",
  },
};

/**
 * Колонки, которые можно подставлять в метрику. Включает сырые числовые
 * колонки + вычисляемые поля (с пометкой ƒx).
 */
export function getMetricOptions(
  dataset: Dataset | undefined,
): { name: string; hint?: string; isCalc?: boolean }[] {
  if (!dataset) return [];
  const out: { name: string; hint?: string; isCalc?: boolean }[] = [];
  for (const c of dataset.columns) {
    if (c.enabled === false) continue;
    if (c.datasetType !== "integer" && c.datasetType !== "float") continue;
    out.push({ name: c.name, hint: c.businessContext || c.description || undefined });
  }
  for (const cf of dataset.calculatedFields ?? []) {
    out.push({
      name: cf.name,
      hint: `ƒx ${cf.formula}`,
      isCalc: true,
    });
  }
  return out;
}

/**
 * Группируемые колонки (ИЗМЕРЕНИЯ): даты/категории/тексты/булевы. Числовые поля
 * (integer/float) — это МЕРЫ (метрики), их в группировке не предлагаем: по ним
 * считают, а не группируют. Так группировка и метрики не пересекаются
 * (раньше числовые меры странно висели и там, и там).
 */
export function getGroupOptions(
  dataset: Dataset | undefined,
): { name: string; hint?: string }[] {
  if (!dataset) return [];
  return dataset.columns
    .filter((c) => c.enabled !== false)
    .filter((c) => c.datasetType !== "integer" && c.datasetType !== "float")
    .map((c) => ({ name: c.name, hint: c.businessContext || undefined }));
}

interface Props {
  dataset: Dataset | undefined;
  /** Колонки группировки правила (для дефолтов в vs_group_avg). */
  ruleGroupBy: string[];
  conditions: AlertCondition[];
  onChange: (conditions: AlertCondition[]) => void;
  /** Колбэк для «+ Формула» — открывает QuickCalcDialog родителя. */
  onAddCalcField?: (insertNameInto: (name: string) => void) => void;
}

export function ConditionsEditor({
  dataset,
  ruleGroupBy,
  conditions,
  onChange,
  onAddCalcField,
}: Props) {
  const metrics = useMemo(() => getMetricOptions(dataset), [dataset]);
  const groups = useMemo(() => getGroupOptions(dataset), [dataset]);

  function update(i: number, patch: AlertCondition) {
    const next = conditions.slice();
    next[i] = patch;
    onChange(next);
  }
  function remove(i: number) {
    onChange(conditions.filter((_, k) => k !== i));
  }
  function add(kind: Kind) {
    const first = metrics[0]?.name ?? "";
    let c: AlertCondition;
    if (kind === "period_change") {
      c = {
        kind: "period_change",
        metric: first,
        periodA: 3,
        periodB: 7,
        operator: ">=",
        value: 20,
      } satisfies AlertConditionPeriodChange;
    } else if (kind === "vs_group_avg") {
      c = {
        kind: "vs_group_avg",
        metric: first,
        groupBy: ruleGroupBy.length > 1 ? ruleGroupBy.slice(0, -1) : ruleGroupBy,
        periodDays: 7,
        operator: ">=",
        value: 30,
      } satisfies AlertConditionVsGroupAvg;
    } else if (kind === "trend") {
      c = {
        kind: "trend",
        metric: first,
        periodA: 3,
        periodB: 7,
        direction: "worsening",
        minChangePercent: 20,
      } satisfies AlertConditionTrend;
    } else {
      c = {
        kind: "threshold",
        metric: first,
        operator: ">=",
        value: 0,
      } satisfies AlertConditionThreshold;
    }
    onChange([...conditions, c]);
  }

  return (
    <div className="space-y-3">
      {conditions.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          Добавьте хотя бы одно условие. Без условий правило найдёт все строки
          выбранной группировки.
        </div>
      )}

      {conditions.map((c, i) => (
        <ConditionCard
          key={i}
          index={i}
          condition={c}
          metrics={metrics}
          groups={groups}
          ruleGroupBy={ruleGroupBy}
          onChange={(next) => update(i, next)}
          onRemove={() => remove(i)}
          onAddCalcField={onAddCalcField}
        />
      ))}

      <div className="flex flex-wrap gap-2">
        <div className="w-full text-xs font-medium text-muted-foreground">
          Добавить условие:
        </div>
        {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
          <Button
            key={k}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => add(k)}
            title={KIND_LABELS[k].hint}
          >
            <Plus />
            {KIND_LABELS[k].label}
          </Button>
        ))}
      </div>

      {conditions.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Все условия объединяются через <span className="font-semibold">AND</span>.
        </p>
      )}
    </div>
  );
}

function ConditionCard({
  index,
  condition,
  metrics,
  groups,
  ruleGroupBy,
  onChange,
  onRemove,
  onAddCalcField,
}: {
  index: number;
  condition: AlertCondition;
  metrics: { name: string; hint?: string; isCalc?: boolean }[];
  groups: { name: string; hint?: string }[];
  ruleGroupBy: string[];
  onChange: (next: AlertCondition) => void;
  onRemove: () => void;
  onAddCalcField?: (insertInto: (name: string) => void) => void;
}) {
  const kind: Kind = condition.kind ?? "threshold";
  const meta = KIND_LABELS[kind];
  // «Знаменатель включён» — производное от данных (metricDenominator), без
  // локального стейта: иначе при удалении/переупорядочивании условий (key=index)
  // тумблер «прилипал» к позиции и мог сбросить чужой знаменатель.
  const denOn = !!(
    (kind === "period_change" || kind === "vs_group_avg" || kind === "trend") &&
    (condition as AlertConditionPeriodChange).metricDenominator
  );

  function changeKind(next: Kind) {
    const m = condition.metric || metrics[0]?.name || "";
    if (next === "threshold") {
      onChange({ kind: "threshold", metric: m, operator: ">=", value: 0 });
    } else if (next === "period_change") {
      onChange({
        kind: "period_change",
        metric: m,
        periodA: 3,
        periodB: 7,
        operator: ">=",
        value: 20,
      });
    } else if (next === "vs_group_avg") {
      onChange({
        kind: "vs_group_avg",
        metric: m,
        groupBy: ruleGroupBy.length > 1 ? ruleGroupBy.slice(0, -1) : ruleGroupBy,
        periodDays: 7,
        operator: ">=",
        value: 30,
      });
    } else {
      onChange({
        kind: "trend",
        metric: m,
        periodA: 3,
        periodB: 7,
        direction: "worsening",
        minChangePercent: 20,
      });
    }
  }

  /** Хелпер: обновить произвольное поле текущего условия. */
  function patch<T extends AlertCondition>(p: Partial<T>) {
    onChange({ ...condition, ...p } as AlertCondition);
  }

  const denominator =
    kind === "period_change" || kind === "vs_group_avg" || kind === "trend"
      ? (condition as AlertConditionPeriodChange).metricDenominator
      : undefined;

  function setDenominator(v?: string) {
    if (
      kind === "period_change" ||
      kind === "vs_group_avg" ||
      kind === "trend"
    ) {
      onChange({
        ...(condition as
          | AlertConditionPeriodChange
          | AlertConditionVsGroupAvg
          | AlertConditionTrend),
        metricDenominator: v || undefined,
      });
    }
  }

  return (
    <div className="rounded-lg border border-border bg-muted/10 p-3">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-brand-500">
              #{index + 1}
            </span>
            <Select value={kind} onValueChange={(v) => changeKind(v as Kind)}>
              <SelectTrigger className="h-8 w-[280px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABELS[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground">{meta.hint}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label="Удалить условие"
        >
          <Trash2 />
        </Button>
      </div>

      {/* Метрика + опциональный знаменатель (ratio: CPA = cost / subs) */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1fr]">
        <div className="space-y-1">
          <Label className="text-xs">
            {denOn ? "Делим (числитель)" : "Метрика"}
          </Label>
          <div className="flex gap-1">
            <MetricSelect
              value={condition.metric}
              metrics={metrics}
              onChange={(v) => patch({ metric: v })}
            />
            {onAddCalcField && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Добавить вычисляемое поле (формула)"
                onClick={() =>
                  onAddCalcField((name) => patch({ metric: name }))
                }
              >
                <Calculator />
              </Button>
            )}
          </div>
        </div>

        {kind !== "threshold" && (
          <>
            <div className="flex items-end justify-center pb-2 text-xs text-muted-foreground">
              ÷
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">
                  на (знаменатель){" "}
                  <span className="text-muted-foreground">— для CPA=cost÷subs</span>
                </Label>
                <Switch
                  checked={denOn}
                  onCheckedChange={(v) => {
                    if (!v) {
                      setDenominator(undefined);
                    } else {
                      // Включаем сразу с дефолтным знаменателем (метрика,
                      // ОТЛИЧНАЯ от числителя — чтобы не было бессмысленного X/X).
                      const other =
                        metrics.find((m) => m.name !== condition.metric) ??
                        metrics[0];
                      setDenominator(other?.name ?? condition.metric);
                    }
                  }}
                />
              </div>
              {denOn && (
                <MetricSelect
                  value={denominator ?? ""}
                  metrics={metrics}
                  onChange={(v) => setDenominator(v)}
                  placeholder="на что делим"
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Пояснение / предупреждение про ratio. */}
      {kind !== "threshold" && denOn && (
        denominator && denominator === condition.metric ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning">
            Числитель и знаменатель одинаковые ({condition.metric} ÷ {denominator}) —
            это всегда 1. Выберите разные поля, например cost ÷ installs.
          </p>
        ) : denominator ? (
          <p className="text-[11px] text-muted-foreground">
            Считаем отношение{" "}
            <span className="font-mono">
              {condition.metric} ÷ {denominator}
            </span>{" "}
            (например CPA). Среднее по группе берётся взвешенно: сумма{" "}
            {condition.metric} ÷ сумма {denominator}.
          </p>
        ) : null
      )}

      {/* Параметры по типу условия */}
      <div className="mt-3 space-y-2">
        {kind === "threshold" && (
          <ThresholdParams
            condition={condition as AlertConditionThreshold}
            onChange={patch}
          />
        )}
        {kind === "period_change" && (
          <PeriodChangeParams
            condition={condition as AlertConditionPeriodChange}
            onChange={patch}
          />
        )}
        {kind === "trend" && (
          <TrendParams
            condition={condition as AlertConditionTrend}
            onChange={patch}
          />
        )}
        {kind === "vs_group_avg" && (
          <VsGroupAvgParams
            condition={condition as AlertConditionVsGroupAvg}
            groups={groups}
            ruleGroupBy={ruleGroupBy}
            onChange={patch}
          />
        )}
      </div>
    </div>
  );
}

function MetricSelect({
  value,
  metrics,
  onChange,
  placeholder = "Выберите метрику",
}: {
  value: string;
  metrics: { name: string; hint?: string; isCalc?: boolean }[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 flex-1">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {metrics.map((m) => (
          <SelectItem key={m.name} value={m.name}>
            <span className="flex items-center gap-2">
              {m.isCalc && (
                <span className="rounded bg-brand-500/15 px-1 font-mono text-[10px] text-brand-500">
                  ƒx
                </span>
              )}
              <span className="font-mono text-xs">{m.name}</span>
            </span>
          </SelectItem>
        ))}
        {value && !metrics.some((m) => m.name === value) && (
          <SelectItem value={value}>
            <span className="font-mono text-xs">{value}</span>
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}

function OperatorSelect({
  value,
  onChange,
}: {
  value: AlertConditionOperator;
  onChange: (v: AlertConditionOperator) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as AlertConditionOperator)}>
      <SelectTrigger className="h-9 w-[68px] font-mono">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPERATORS.map((op) => (
          <SelectItem key={op} value={op}>
            {op}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ThresholdParams({
  condition,
  onChange,
}: {
  condition: AlertConditionThreshold;
  onChange: (p: Partial<AlertConditionThreshold>) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label className="text-xs">Оператор</Label>
        <OperatorSelect
          value={condition.operator}
          onChange={(v) => onChange({ operator: v })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Значение</Label>
        <Input
          type="number"
          className="w-32"
          value={String(condition.value)}
          onChange={(e) => onChange({ value: Number(e.target.value) || 0 })}
        />
      </div>
      <p className="ml-2 self-center pt-4 text-xs text-muted-foreground">
        Сумма метрики за период правила {condition.operator} {condition.value}
      </p>
    </div>
  );
}

function PeriodChangeParams({
  condition,
  onChange,
}: {
  condition: AlertConditionPeriodChange;
  onChange: (p: Partial<AlertConditionPeriodChange>) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <NumberField
        label="Период A (дней)"
        value={condition.periodA}
        onChange={(v) => onChange({ periodA: v })}
        min={1}
        max={90}
      />
      <span className="self-center pb-2 text-xs text-muted-foreground">vs</span>
      <NumberField
        label="Период B (дней)"
        value={condition.periodB}
        onChange={(v) => onChange({ periodB: v })}
        min={1}
        max={90}
      />
      <div className="space-y-1">
        <Label className="text-xs">Изменение</Label>
        <OperatorSelect
          value={condition.operator}
          onChange={(v) => onChange({ operator: v })}
        />
      </div>
      <NumberField
        label="%"
        value={condition.value}
        onChange={(v) => onChange({ value: v })}
        step={1}
      />
      <p className="ml-2 self-center pt-4 text-xs text-muted-foreground">
        ((A − B) / B) × 100 {condition.operator} {condition.value}%
      </p>
    </div>
  );
}

function TrendParams({
  condition,
  onChange,
}: {
  condition: AlertConditionTrend;
  onChange: (p: Partial<AlertConditionTrend>) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <NumberField
        label="Период A (дней)"
        value={condition.periodA}
        onChange={(v) => onChange({ periodA: v })}
        min={1}
        max={90}
      />
      <span className="self-center pb-2 text-xs text-muted-foreground">vs</span>
      <NumberField
        label="Период B (дней)"
        value={condition.periodB}
        onChange={(v) => onChange({ periodB: v })}
        min={1}
        max={90}
      />
      <div className="space-y-1">
        <Label className="text-xs">Направление</Label>
        <Select
          value={condition.direction}
          onValueChange={(v) =>
            onChange({ direction: v as AlertConditionTrend["direction"] })
          }
        >
          <SelectTrigger className="h-9 w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="worsening">Ухудшение (рост)</SelectItem>
            <SelectItem value="improving">Улучшение (спад)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <NumberField
        label="Мин. % изменения"
        value={condition.minChangePercent}
        onChange={(v) => onChange({ minChangePercent: Math.abs(v) })}
        step={1}
      />
    </div>
  );
}

function VsGroupAvgParams({
  condition,
  groups,
  ruleGroupBy,
  onChange,
}: {
  condition: AlertConditionVsGroupAvg;
  groups: { name: string; hint?: string }[];
  ruleGroupBy: string[];
  onChange: (p: Partial<AlertConditionVsGroupAvg>) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-xs">
          Подгруппа{" "}
          <span className="text-muted-foreground">
            (по каким полям вычислять среднее)
          </span>
        </Label>
        <MultiColumnPicker
          value={condition.groupBy}
          onChange={(v) => onChange({ groupBy: v })}
          options={groups}
          placeholder="Например: channel + GEO"
        />
        {ruleGroupBy.length > 0 &&
          condition.groupBy.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              Если оставить пусто — среднее будет по всему датасету.
            </p>
          )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <NumberField
          label="Период (дней)"
          value={condition.periodDays}
          onChange={(v) => onChange({ periodDays: v })}
          min={1}
          max={90}
        />
        <div className="space-y-1">
          <Label className="text-xs">Отклонение</Label>
          <OperatorSelect
            value={condition.operator}
            onChange={(v) => onChange({ operator: v })}
          />
        </div>
        <NumberField
          label="% от среднего"
          value={condition.value}
          onChange={(v) => onChange({ value: v })}
          step={1}
        />
      </div>
      <p className="rounded-md border border-border bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground">
        {vsGroupAvgHuman(condition)}
      </p>
    </div>
  );
}

/**
 * Человеко-понятное пояснение порога «хуже/лучше среднего» в стиле
 * «×коэффициент»: ≥30% → «в 1.3× выше среднего по группе».
 */
function vsGroupAvgHuman(c: AlertConditionVsGroupAvg): string {
  const metric = c.metricDenominator
    ? `${c.metric} / ${c.metricDenominator}`
    : c.metric;
  const pct = Math.abs(c.value);
  const k = (1 + pct / 100).toFixed(2).replace(/\.00$/, "");
  const groupTxt =
    c.groupBy.length > 0 ? c.groupBy.join(" + ") : "всему датасету";
  const avgKind = c.metricDenominator
    ? "среднее считается взвешенно: сумма числителя ÷ сумма знаменателя по группе"
    : "среднее — обычное по группе";
  const op = c.operator;
  if (op === ">" || op === ">=") {
    return `Сработает, если ${metric} объекта в ${k}× и больше относительно среднего по ${groupTxt} (т.е. на ${pct}% хуже). ${cap(avgKind)}.`;
  }
  if (op === "<" || op === "<=") {
    const kLow = (1 - pct / 100).toFixed(2).replace(/\.00$/, "");
    return `Сработает, если ${metric} объекта ≤ ${kLow}× от среднего по ${groupTxt} (т.е. на ${pct}% лучше). ${cap(avgKind)}.`;
  }
  return `Отклонение ${metric} от среднего по ${groupTxt} = ${c.value}%. ${cap(avgKind)}.`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  className,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        className={cn("w-28", className)}
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </div>
  );
}
