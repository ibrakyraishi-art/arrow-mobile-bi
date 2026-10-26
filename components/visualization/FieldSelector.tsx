"use client";

import type {
  CalculatedField,
  CalculatedFieldFormat,
  DatasetColumn,
  PivotValueConfig,
  AggregationType,
} from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VirtualField } from "@/lib/plan";
import { Button } from "@/components/ui/button";
import { isDimensionType, isMeasureType } from "@/lib/type-mapping";
import { ALL_AGGREGATIONS } from "@/lib/aggregation";
import {
  computeAggregateFlags,
  prepareCalculatedFields,
} from "@/lib/formula";
import { Calculator, Plus, Target, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AGGREGATION_LABEL, columnLabel, resolveValueFormat } from "@/lib/format-value";

/**
 * Имя поля в конструкторе: человеческое название (описание колонки) и сырое
 * имя вторичной подписью — чтобы было видно, какая колонка в источнике.
 */
function FieldName({ name, columns }: { name: string; columns: DatasetColumn[] }) {
  const human = columnLabel(name, { datasetColumns: columns });
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5 truncate">
      <span className="truncate">{human}</span>
      {human !== name && (
        <span className="truncate font-mono text-[10px] text-muted-foreground">{name}</span>
      )}
    </span>
  );
}

interface MeasureOption {
  name: string;
  isCalculated: boolean;
}

function buildMeasureOptions(
  columns: DatasetColumn[],
  calculatedFields: CalculatedField[] = [],
): MeasureOption[] {
  const regular: MeasureOption[] = columns
    .filter((c) => c.enabled && isMeasureType(c.datasetType))
    .map((c) => ({ name: c.name, isCalculated: false }));
  const calculated: MeasureOption[] = calculatedFields.map((c) => ({
    name: c.name,
    isCalculated: true,
  }));
  return [...regular, ...calculated];
}

/** Имена вычисляемых полей, являющихся aggregate-level (SUM/AVG/… в формуле). */
function aggregateCalcNames(
  calculatedFields: CalculatedField[] = [],
): Set<string> {
  const flags = computeAggregateFlags(
    prepareCalculatedFields(calculatedFields),
  );
  const out = new Set<string>();
  for (const [name, isAgg] of flags) if (isAgg) out.add(name);
  return out;
}

/** Чип-«АГГ» вместо селектора агрегации для aggregate-вычисляемого поля. */
function AggBadge() {
  return (
    <span
      className="inline-flex h-7 w-[90px] shrink-0 items-center justify-center gap-1 rounded-md border border-brand-500/40 bg-brand-500/10 px-1 text-[10px] font-mono font-bold uppercase tracking-wider text-brand-500"
      title="Агрегация уже задана в формуле (SUM/AVG/…)"
    >
      ƒx · агг
    </span>
  );
}

/** Короткие подписи форматов для выбора у значения. */
const FORMAT_SHORT: Record<CalculatedFieldFormat, string> = {
  number: "1,5",
  integer: "123",
  currency_rub: "₽",
  currency_usd: "$",
  percent: "%",
};
const FORMAT_LABEL: Record<CalculatedFieldFormat, string> = {
  number: "Число",
  integer: "Целое",
  currency_rub: "Рубли, ₽",
  currency_usd: "Доллары, $",
  percent: "Проценты, %",
};
const AUTO = "auto";

/**
 * Выбор формата значения (₽/$/%/число). «Авто» — формат поля или угаданный
 * по суффиксу `_rub`/`_usd`; в подписи «Авто» показан, во что он раскрылся.
 */
function FormatSelect({
  value,
  valueFormats,
  calculatedFields,
  onChange,
}: {
  value: PivotValueConfig;
  valueFormats?: Record<string, CalculatedFieldFormat>;
  calculatedFields?: Pick<CalculatedField, "name" | "format">[];
  onChange: (format: CalculatedFieldFormat | undefined) => void;
}) {
  const explicit = valueFormats?.[value.column];
  const auto = resolveValueFormat(value, { calculatedFields });
  return (
    <Select
      value={explicit ?? AUTO}
      onValueChange={(v) => onChange(v === AUTO ? undefined : (v as CalculatedFieldFormat))}
    >
      <SelectTrigger
        className="h-7 w-[52px] shrink-0 px-1.5 text-[11px]"
        title="Формат значения"
      >
        <span className={cn(!explicit && "text-muted-foreground")}>
          {FORMAT_SHORT[explicit ?? auto ?? "number"]}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTO} className="text-xs">
          Авто{auto ? ` (${FORMAT_SHORT[auto]})` : ""}
        </SelectItem>
        {(Object.keys(FORMAT_LABEL) as CalculatedFieldFormat[]).map((f) => (
          <SelectItem key={f} value={f} className="text-xs">
            {FORMAT_LABEL[f]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Чип вместо агрегации у поля плана: значение считает сервер по плану. */
function PlanBadge() {
  return (
    <span
      className="inline-flex h-7 w-[90px] shrink-0 items-center justify-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-1 text-[10px] font-bold uppercase tracking-wider text-primary"
      title="Поле плана: значение считается по плану проекта, агрегация не нужна"
    >
      <Target className="h-3 w-3" />
      план
    </span>
  );
}

/** Группа «План» в выпадающем списке мер: по 5 виртуальных полей на поле плана. */
function PlanOptions({ planFields }: { planFields?: VirtualField[] }) {
  if (!planFields || planFields.length === 0) return null;
  return (
    <>
      <SelectSeparator />
      <SelectGroup>
        <SelectLabel className="flex items-center gap-1.5 text-primary">
          <Target className="h-3 w-3" />
          План
        </SelectLabel>
        {planFields.map((f) => (
          <SelectItem key={f.name} value={f.name} title={f.description}>
            <span className="flex items-center gap-1.5 text-xs">
              <Target className="h-3 w-3 text-primary" />
              {f.name}
            </span>
          </SelectItem>
        ))}
      </SelectGroup>
    </>
  );
}

/** Поле плана как «имя + формат» для угадывания формата. */
function planAsField(f: VirtualField): Pick<CalculatedField, "name" | "format"> {
  return { name: f.name, format: f.format };
}

/** Подсказка под выбранным полем плана (как считается, общий план в разрезе). */
function PlanHint({ field }: { field: VirtualField | undefined }) {
  if (!field) return null;
  return (
    <p
      className="line-clamp-3 px-1 text-[10px] leading-snug text-muted-foreground"
      title={field.description}
    >
      {field.description}
    </p>
  );
}

export function DimensionList({
  columns,
  selected,
  onChange,
  label,
}: {
  columns: DatasetColumn[];
  selected: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  const dims = columns.filter(
    (c) => c.enabled && isDimensionType(c.datasetType),
  );
  const available = dims.filter((c) => !selected.includes(c.name));

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="space-y-1.5">
        {selected.map((s) => (
          <div
            key={s}
            className="group flex items-center justify-between gap-2 rounded-md border border-border bg-card/60 px-2.5 py-1.5 text-xs"
          >
            <span className="min-w-0 truncate">
              <FieldName name={s} columns={columns} />
            </span>
            <button
              type="button"
              onClick={() => onChange(selected.filter((x) => x !== s))}
              className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-all"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {available.length > 0 && (
          <Select
            value=""
            onValueChange={(v) => onChange([...selected, v])}
          >
            <SelectTrigger className="h-8 text-xs border-dashed">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Plus className="h-3.5 w-3.5" />
                <SelectValue placeholder="Добавить поле" />
              </div>
            </SelectTrigger>
            <SelectContent>
              {available.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  <span className="text-xs">
                    <FieldName name={c.name} columns={columns} />
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

export function ValueList({
  columns,
  calculatedFields,
  planFields,
  selected,
  onChange,
  label,
  valueFormats,
  onFormatChange,
}: {
  columns: DatasetColumn[];
  calculatedFields?: CalculatedField[];
  /** Виртуальные поля плана датасета — группа «План» в списке мер. */
  planFields?: VirtualField[];
  selected: PivotValueConfig[];
  onChange: (v: PivotValueConfig[]) => void;
  label: string;
  /** Форматы значений визуализации; с `onFormatChange` у значения появляется выбор формата. */
  valueFormats?: Record<string, CalculatedFieldFormat>;
  onFormatChange?: (column: string, format: CalculatedFieldFormat | undefined) => void;
}) {
  const measures = buildMeasureOptions(columns, calculatedFields);
  const planByName = new Map((planFields ?? []).map((f) => [f.name, f]));
  // Для «Авто»: форматы вычисляемых полей и полей плана.
  const formatFields = [
    ...(calculatedFields ?? []),
    ...(planFields ?? []).map(planAsField),
  ];
  const calcNames = new Set(
    (calculatedFields ?? []).map((c) => c.name),
  );
  const aggCalcNames = aggregateCalcNames(calculatedFields);

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="space-y-1.5">
        {selected.map((v, idx) => (
          <div key={`${v.column}-${idx}`} className="space-y-1">
            <div className="flex items-center gap-2 rounded-md border border-border bg-card/60 p-1.5">
              {planByName.has(v.column) ? (
                <PlanBadge />
              ) : aggCalcNames.has(v.column) ? (
                <AggBadge />
              ) : (
                <Select
                  value={v.aggregation}
                  onValueChange={(x) => {
                    const next = selected.slice();
                    next[idx] = { ...v, aggregation: x as AggregationType };
                    onChange(next);
                  }}
                >
                  <SelectTrigger className="h-7 w-[104px] text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_AGGREGATIONS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {AGGREGATION_LABEL[a]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <span className="text-muted-foreground">·</span>
              {calcNames.has(v.column) && (
                <Calculator
                  className="h-3.5 w-3.5 text-primary shrink-0"
                  aria-label="Вычисляемое поле"
                />
              )}
              <span className="min-w-0 flex-1 truncate text-xs">
                <FieldName name={v.column} columns={columns} />
              </span>
              {onFormatChange && (
                <FormatSelect
                  value={v}
                  valueFormats={valueFormats}
                  calculatedFields={formatFields}
                  onChange={(f) => onFormatChange(v.column, f)}
                />
              )}
              <button
                type="button"
                onClick={() =>
                  onChange(selected.filter((_, i) => i !== idx))
                }
                className="text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <PlanHint field={planByName.get(v.column)} />
          </div>
        ))}
        {(measures.length > 0 || planByName.size > 0) && (
          <Select
            value=""
            onValueChange={(v) =>
              onChange([...selected, { column: v, aggregation: "SUM" }])
            }
          >
            <SelectTrigger className="h-8 text-xs border-dashed">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Plus className="h-3.5 w-3.5" />
                <SelectValue placeholder="Добавить меру" />
              </div>
            </SelectTrigger>
            <SelectContent>
              {measures.map((m) => (
                <SelectItem key={m.name} value={m.name}>
                  <span className="flex items-center gap-1.5 text-xs">
                    {m.isCalculated && (
                      <Calculator className="h-3 w-3 text-primary" />
                    )}
                    <FieldName name={m.name} columns={columns} />
                  </span>
                </SelectItem>
              ))}
              <PlanOptions planFields={planFields} />
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

export function SingleDimensionSelect({
  columns,
  value,
  onChange,
  label,
  allowClear,
}: {
  columns: DatasetColumn[];
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  label: string;
  allowClear?: boolean;
}) {
  const dims = columns.filter(
    (c) => c.enabled && isDimensionType(c.datasetType),
  );
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="flex items-center gap-1.5">
        <Select
          value={value ?? ""}
          onValueChange={(v) => onChange(v || null)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Выберите поле" />
          </SelectTrigger>
          <SelectContent>
            {dims.map((c) => (
              <SelectItem key={c.name} value={c.name}>
                <span className="text-xs">
                  <FieldName name={c.name} columns={columns} />
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {allowClear && value && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onChange(null)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function SingleMeasureSelect({
  columns,
  calculatedFields,
  planFields,
  value,
  onChange,
  label,
  valueFormats,
  onFormatChange,
}: {
  columns: DatasetColumn[];
  calculatedFields?: CalculatedField[];
  /** Виртуальные поля плана датасета — группа «План» в списке мер. */
  planFields?: VirtualField[];
  value: PivotValueConfig | undefined;
  onChange: (v: PivotValueConfig | undefined) => void;
  label: string;
  /** Форматы значений визуализации; с `onFormatChange` рядом появляется выбор формата. */
  valueFormats?: Record<string, CalculatedFieldFormat>;
  onFormatChange?: (column: string, format: CalculatedFieldFormat | undefined) => void;
}) {
  const measures = buildMeasureOptions(columns, calculatedFields);
  const selectedPlan = value?.column
    ? (planFields ?? []).find((f) => f.name === value.column)
    : undefined;
  const calcNames = new Set(
    (calculatedFields ?? []).map((c) => c.name),
  );
  const aggCalcNames = aggregateCalcNames(calculatedFields);
  const selectedIsCalc = value?.column ? calcNames.has(value.column) : false;
  const selectedIsAggCalc = value?.column
    ? aggCalcNames.has(value.column)
    : false;
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="flex items-center gap-1.5">
        {selectedPlan ? (
          <PlanBadge />
        ) : selectedIsAggCalc ? (
          <AggBadge />
        ) : (
          <Select
            value={value?.aggregation ?? "SUM"}
            onValueChange={(a) =>
              onChange(
                value
                  ? { ...value, aggregation: a as AggregationType }
                  : undefined,
              )
            }
          >
            <SelectTrigger className="h-8 w-[104px] text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_AGGREGATIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {AGGREGATION_LABEL[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select
          value={value?.column ?? ""}
          onValueChange={(v) =>
            onChange({ column: v, aggregation: value?.aggregation ?? "SUM" })
          }
        >
          <SelectTrigger className={cn("h-8 text-xs flex-1")}>
            <div className="flex items-center gap-1.5">
              {selectedIsCalc && (
                <Calculator className="h-3 w-3 text-primary shrink-0" />
              )}
              <SelectValue placeholder="Выберите меру" />
            </div>
          </SelectTrigger>
          <SelectContent>
            {measures.map((m) => (
              <SelectItem key={m.name} value={m.name}>
                <span className="flex items-center gap-1.5 text-xs">
                  {m.isCalculated && (
                    <Calculator className="h-3 w-3 text-primary" />
                  )}
                  <FieldName name={m.name} columns={columns} />
                </span>
              </SelectItem>
            ))}
            <PlanOptions planFields={planFields} />
          </SelectContent>
        </Select>
        {onFormatChange && value?.column && (
          <FormatSelect
            value={value}
            valueFormats={valueFormats}
            calculatedFields={[
              ...(calculatedFields ?? []),
              ...(planFields ?? []).map(planAsField),
            ]}
            onChange={(f) => onFormatChange(value.column, f)}
          />
        )}
      </div>
      <PlanHint field={selectedPlan} />
    </div>
  );
}
