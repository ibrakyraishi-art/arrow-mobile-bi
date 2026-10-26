"use client";

import { useMemo } from "react";
import { AlertTriangle, Calculator, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  AggregationType,
  CalculatedField,
  Dataset,
  PivotValueConfig,
} from "@/lib/types";
import {
  computeAggregateFlags,
  prepareCalculatedFields,
} from "@/lib/formula";
import { explainFormulaError } from "@/lib/formula-help";
import { cn } from "@/lib/utils";
import { getMetricOptions } from "./ConditionsEditor";

const AGGREGATIONS: AggregationType[] = ["SUM", "AVG", "COUNT", "MIN", "MAX"];

/**
 * Редактор списка метрик таблицы (колонка + агрегация) + управление
 * вычисляемыми полями датасета (создать/редактировать/удалить, с пометкой
 * сломанных формул — например вложенный агрегат SUM([agg-поле])).
 */
export function MetricsEditor({
  dataset,
  value,
  onChange,
  onAddCalcField,
  onEditCalcField,
  onDeleteCalcField,
}: {
  dataset: Dataset | undefined;
  value: PivotValueConfig[];
  onChange: (v: PivotValueConfig[]) => void;
  onAddCalcField?: (insertNameInto: (name: string) => void) => void;
  onEditCalcField?: (field: CalculatedField) => void;
  onDeleteCalcField?: (field: CalculatedField) => void;
}) {
  const options = useMemo(() => getMetricOptions(dataset), [dataset]);

  // Валидация каждого вычисляемого поля датасета — чтобы показать сломанные
  // с понятным объяснением (как в QuickCalcDialog).
  const calcFields = dataset?.calculatedFields ?? [];
  const calcIssues = useMemo(() => {
    const names = [
      ...(dataset?.columns ?? []).map((c) => c.name),
      ...calcFields.map((c) => c.name),
    ];
    const prepared = prepareCalculatedFields(calcFields);
    const flags = computeAggregateFlags(prepared);
    const isAgg = (n: string) => flags.get(n) === true;
    const map = new Map<string, string>();
    for (const cf of calcFields) {
      const others = names.filter((n) => n !== cf.name);
      const help = explainFormulaError(cf.formula, [...others, cf.name], isAgg);
      if (help) map.set(cf.id, help.message);
    }
    return map;
  }, [dataset, calcFields]);

  // Имена aggregate-вычисляемых полей (формула уже содержит SUM/AVG/…).
  // Для них агрегация в таблице не применяется — считается по формуле.
  const isAggCalcName = useMemo(() => {
    const prepared = prepareCalculatedFields(calcFields);
    const flags = computeAggregateFlags(prepared);
    return (name: string) => flags.get(name) === true;
  }, [calcFields]);

  function add() {
    onChange([...value, { column: options[0]?.name ?? "", aggregation: "SUM" }]);
  }
  function update(i: number, patch: Partial<PivotValueConfig>) {
    const next = value.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function remove(i: number) {
    onChange(value.filter((_, k) => k !== i));
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          Добавьте метрики (Расход, Триалы, CPA …) — это колонки сводной таблицы.
        </div>
      )}

      {value.map((m, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Метрика</Label>
            <Select
              value={m.column}
              onValueChange={(v) =>
                // Для aggregate-поля фиксируем SUM (агрегация всё равно
                // игнорируется) — чтобы заголовок колонки был чистым.
                update(i, isAggCalcName(v) ? { column: v, aggregation: "SUM" } : { column: v })
              }
            >
              <SelectTrigger className="h-9 w-[210px]">
                <SelectValue placeholder="Колонка" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.name} value={o.name}>
                    <span className="flex items-center gap-2">
                      {o.isCalc && (
                        <span className="rounded bg-brand-500/15 px-1 font-mono text-[10px] text-brand-500">
                          ƒx
                        </span>
                      )}
                      <span className="font-mono text-xs">{o.name}</span>
                    </span>
                  </SelectItem>
                ))}
                {m.column && !options.some((o) => o.name === m.column) && (
                  <SelectItem value={m.column}>
                    <span className="font-mono text-xs">{m.column}</span>
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Агрегация</Label>
            {isAggCalcName(m.column) ? (
              // Aggregate-вычисляемое поле считается по своей формуле —
              // внешняя агрегация к нему не применяется. Показываем пометку
              // вместо выпадашки, чтобы не путать (SUM от CPA не имеет смысла).
              <div
                className="flex h-9 w-[110px] items-center gap-1 rounded-md border border-border bg-muted/30 px-2 text-xs text-muted-foreground"
                title="Это вычисляемое поле считается по своей формуле. Агрегация к нему не применяется."
              >
                <span className="font-mono text-[10px] text-brand-500">ƒx</span>
                по формуле
              </div>
            ) : (
              <Select
                value={m.aggregation}
                onValueChange={(v) =>
                  update(i, { aggregation: v as AggregationType })
                }
              >
                <SelectTrigger className="h-9 w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGGREGATIONS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => remove(i)}
            aria-label="Удалить метрику"
          >
            <Trash2 />
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus />
          Метрика
        </Button>
        {onAddCalcField && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onAddCalcField((name) =>
                onChange([...value, { column: name, aggregation: "SUM" }]),
              )
            }
          >
            <Calculator />
            Формула
          </Button>
        )}
      </div>

      {/* Вычисляемые поля датасета: редактирование/удаление + пометка сломанных. */}
      {calcFields.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/10 p-2">
          <div className="text-xs font-medium text-muted-foreground">
            Вычисляемые поля датасета (ƒx)
          </div>
          {calcFields.map((cf) => {
            const issue = calcIssues.get(cf.id);
            return (
              <div
                key={cf.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1.5",
                  issue
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-border bg-background",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {issue && (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                    )}
                    <span className="font-mono text-xs">{cf.name}</span>
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {cf.formula}
                  </div>
                  {issue && (
                    <div className="text-[11px] text-destructive">{issue}</div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {onEditCalcField && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onEditCalcField(cf)}
                      aria-label="Редактировать поле"
                      title="Редактировать формулу"
                    >
                      <Pencil />
                    </Button>
                  )}
                  {onDeleteCalcField && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onDeleteCalcField(cf)}
                      aria-label="Удалить поле"
                      title="Удалить вычисляемое поле"
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          <p className="text-[11px] text-muted-foreground">
            Поля с{" "}
            <AlertTriangle className="inline h-3 w-3 text-destructive" /> —
            сломанная формула (например, агрегат внутри агрегата). Отредактируйте
            или удалите, иначе таблица не построится.
          </p>
        </div>
      )}
    </div>
  );
}
