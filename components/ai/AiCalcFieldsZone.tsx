"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Calculator, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useDatasetStore } from "@/stores/datasetStore";
import { QuickCalcDialog } from "@/components/notifications/QuickCalcDialog";
import { computeAggregateFlags, prepareCalculatedFields } from "@/lib/formula";
import { explainFormulaError } from "@/lib/formula-help";
import type { CalculatedField, Dataset, PivotValueConfig } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  dataset: Dataset;
  metrics: PivotValueConfig[];
  /** Чтобы добавить созданное поле в метрики и подчистить ссылки при удалении. */
  onMetricsChange: (next: PivotValueConfig[]) => void;
}

/**
 * Зона ВЫЧИСЛЯЕМЫЕ ПОЛЯ — формулы с агрегатными функциями (SUM([cost]) /
 * [subs] и т.п.), Excel-стиль. Переиспользует ровно тот же движок формул и
 * QuickCalcDialog, что и Telegram-алерты (без дублирования логики). Созданное
 * поле сразу добавляется в метрики; сломанные формулы подсвечиваются.
 */
export function AiCalcFieldsZone({ dataset, metrics, onMetricsChange }: Props) {
  const { toast } = useToast();
  const updateDataset = useDatasetStore((s) => s.updateDataset);

  const [calcOpen, setCalcOpen] = useState(false);
  const [calcTarget, setCalcTarget] = useState<((name: string) => void) | null>(
    null,
  );
  const [calcEditing, setCalcEditing] = useState<CalculatedField | null>(null);

  const calcFields = dataset.calculatedFields ?? [];

  // Валидация каждого поля — подсветить сломанные (например, вложенный агрегат).
  const calcIssues = useMemo(() => {
    const names = [
      ...dataset.columns.map((c) => c.name),
      ...calcFields.map((c) => c.name),
    ];
    const prepared = prepareCalculatedFields(calcFields);
    const flags = computeAggregateFlags(prepared);
    const isAgg = (n: string) => flags.get(n) === true;
    const map = new Map<string, string>();
    for (const cf of calcFields) {
      // Имя должно быть валидным SQL-идентификатором (без пробелов/спецсимволов),
      // иначе запрос упадёт «Недопустимое имя столбца». Подсвечиваем сразу.
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cf.name)) {
        map.set(
          cf.id,
          "Имя с пробелами/спецсимволами — запрос отклонит столбец. Откройте ✎ и нажмите «Исправить».",
        );
        continue;
      }
      const others = names.filter((n) => n !== cf.name);
      const help = explainFormulaError(cf.formula, [...others, cf.name], isAgg);
      if (help) map.set(cf.id, help.message);
    }
    return map;
  }, [dataset.columns, calcFields]);

  function addAsMetric(name: string) {
    if (metrics.some((m) => m.column === name)) return;
    onMetricsChange([...metrics, { column: name, aggregation: "SUM" }]);
  }

  function openCreate() {
    setCalcTarget(() => addAsMetric);
    setCalcEditing(null);
    setCalcOpen(true);
  }
  function openEdit(field: CalculatedField) {
    setCalcTarget(null);
    setCalcEditing(field);
    setCalcOpen(true);
  }

  async function deleteCalcField(field: CalculatedField) {
    if (
      !window.confirm(
        `Удалить вычисляемое поле «${field.name}»? Оно пропадёт из метрик и из датасета.`,
      )
    )
      return;
    try {
      const next = calcFields.filter((f) => f.id !== field.id);
      await updateDataset(dataset.id, { calculatedFields: next });
      onMetricsChange(metrics.filter((m) => m.column !== field.name));
      toast({ title: `Поле «${field.name}» удалено`, variant: "success" });
    } catch (e) {
      toast({
        title: "Не удалось удалить поле",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-2">
      {calcFields.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-2.5 text-[11px] leading-snug text-muted-foreground">
          Формулы с агрегатами, напр.{" "}
          <code className="rounded bg-muted px-1 font-mono text-[10px]">
            CPA = SUM([cost]) / [installs]
          </code>
          . Созданное поле добавится в метрики.
        </div>
      ) : (
        <div className="space-y-1.5">
          {calcFields.map((cf) => {
            const issue = calcIssues.get(cf.id);
            return (
              <div
                key={cf.id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border p-1.5",
                  issue
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-border bg-card",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-primary/15 px-1 font-mono text-[9px] text-primary">
                      ƒx
                    </span>
                    {issue && (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                    )}
                    <span className="truncate font-mono text-xs text-foreground">
                      {cf.name}
                    </span>
                  </div>
                  <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                    {cf.formula}
                  </div>
                  {issue && (
                    <div className="text-[10.5px] leading-snug text-destructive">
                      {issue}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => openEdit(cf)}
                    title="Редактировать формулу"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-accent hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteCalcField(cf)}
                    title="Удалить поле"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-destructive/15 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full text-xs"
        onClick={openCreate}
      >
        <Calculator className="h-3.5 w-3.5" /> Добавить формулу
      </Button>

      <QuickCalcDialog
        open={calcOpen}
        onOpenChange={(v) => {
          setCalcOpen(v);
          if (!v) {
            setCalcTarget(null);
            setCalcEditing(null);
          }
        }}
        dataset={dataset}
        editing={calcEditing}
        onCreated={(cf) => calcTarget?.(cf.name)}
      />
    </div>
  );
}
