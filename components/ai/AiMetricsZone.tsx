"use client";

import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getMetricOptions } from "@/components/notifications/ConditionsEditor";
import type { AggregationType, Dataset, PivotValueConfig } from "@/lib/types";

const AGGREGATIONS: AggregationType[] = ["SUM", "AVG", "COUNT", "MIN", "MAX"];

interface Props {
  dataset: Dataset;
  /** Измерения группировки — исключаются из выбора метрик (поле — либо строка, либо метрика). */
  groupBy: string[];
  metrics: PivotValueConfig[];
  onChange: (next: PivotValueConfig[]) => void;
}

/**
 * Зона МЕТРИКИ — числовые показатели сводной таблицы. В выпадашку попадают
 * ТОЛЬКО числовые колонки и (числовые) вычисляемые поля; поля группировки и
 * нечисловые столбцы (даты, периоды, тексты) исключены. У каждой метрики —
 * агрегация (SUM/AVG/COUNT/MIN/MAX); у вычисляемого поля-агрегата агрегация
 * задаётся самой формулой, поэтому показывается «по формуле».
 */
export function AiMetricsZone({ dataset, groupBy, metrics, onChange }: Props) {
  // Числовые метрики + вычисляемые поля, без полей, уже ушедших в группировку.
  const options = useMemo(
    () => getMetricOptions(dataset).filter((o) => !groupBy.includes(o.name)),
    [dataset, groupBy],
  );

  // ЛЮБОЕ вычисляемое поле считается ПО ФОРМУЛЕ — внешняя агрегация к нему не
  // применяется (агрегация задаётся прямо в формуле; row-level поле как метрика
  // на сервере поднимается до агрегата — доля из сумм по группе). Внешний
  // SUM/AVG показываем только для обычных столбцов.
  const calcNames = useMemo(
    () => new Set((dataset.calculatedFields ?? []).map((f) => f.name)),
    [dataset.calculatedFields],
  );
  const isCalcName = (name: string) => calcNames.has(name);

  function add() {
    onChange([
      ...metrics,
      { column: options[0]?.name ?? "", aggregation: "SUM" },
    ]);
  }
  function update(i: number, patch: Partial<PivotValueConfig>) {
    const next = metrics.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function remove(i: number) {
    onChange(metrics.filter((_, k) => k !== i));
  }

  return (
    <div className="space-y-2">
      {metrics.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-2.5 text-[11px] leading-snug text-muted-foreground">
          Метрики не заданы — будут просуммированы{" "}
          <b className="text-foreground">все числовые поля</b>. Добавьте, чтобы
          выбрать конкретные показатели и агрегацию.
        </div>
      )}

      {metrics.map((m, i) => {
        const isCalc = isCalcName(m.column);
        return (
          <div
            key={i}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card p-1.5"
          >
            <Select
              value={m.column}
              onValueChange={(v) =>
                update(i, isCalcName(v) ? { column: v, aggregation: "SUM" } : { column: v })
              }
            >
              <SelectTrigger className="h-8 flex-1 text-xs">
                <SelectValue placeholder="Поле" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.name} value={o.name}>
                    <span className="flex items-center gap-1.5">
                      {o.isCalc && (
                        <span className="rounded bg-primary/15 px-1 font-mono text-[9px] text-primary">
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

            {isCalc ? (
              <span
                className="flex h-8 w-[92px] items-center justify-center gap-1 rounded-md border border-border bg-muted/30 text-[11px] text-muted-foreground"
                title="Вычисляемое поле считается по своей формуле — внешняя агрегация не применяется."
              >
                <span className="font-mono text-[9px] text-primary">ƒx</span>
                по формуле
              </span>
            ) : (
              <Select
                value={m.aggregation}
                onValueChange={(v) => update(i, { aggregation: v as AggregationType })}
              >
                <SelectTrigger className="h-8 w-[92px] text-xs">
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

            <button
              type="button"
              onClick={() => remove(i)}
              title="Удалить метрику"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint hover:bg-destructive/15 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full text-xs"
        onClick={add}
        disabled={options.length === 0}
      >
        <Plus className="h-3.5 w-3.5" /> Добавить метрику
      </Button>
    </div>
  );
}
