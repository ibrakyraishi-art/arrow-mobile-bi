"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { usePlanStore } from "@/stores/planStore";
import { suggestPlanFieldDefaults, suggestPlanFieldLabel } from "@/lib/plan";
import { CALCULATED_FIELD_FORMAT_OPTIONS } from "@/lib/format-value";
import {
  PLAN_DIRECTIONS,
  PLAN_KINDS,
  type CalculatedFieldFormat,
  type Dataset,
  type PlanDirection,
  type PlanField,
  type PlanKind,
  type PlanProject,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { DIRECTION_LABEL, KIND_HINT, KIND_LABEL, errorText, metricOptionsOf } from "./plan-ui";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: PlanProject;
  dataset: Dataset | undefined;
  /** Есть — редактирование поля. */
  field?: PlanField;
}

/** Формат по умолчанию: у вычисляемого поля — его формат, у колонки — по имени/типу. */
function defaultFormat(dataset: Dataset | undefined, column: string): CalculatedFieldFormat {
  const calc = dataset?.calculatedFields?.find((c) => c.name === column);
  if (calc?.format) return calc.format;
  const c = column.toLowerCase();
  if (/(rub|руб|₽)/.test(c)) return "currency_rub";
  if (/(usd|\$)/.test(c)) return "currency_usd";
  if (/(%|roas|roi|ctr|^cr|\scr)/.test(c)) return "percent";
  const col = dataset?.columns.find((x) => x.name === column);
  return col?.datasetType === "integer" ? "integer" : "number";
}

/** Добавление / правка поля плана (история 21) с умными дефолтами. */
export function PlanFieldDialog({ open, onOpenChange, project, dataset, field }: Props) {
  const upsertField = usePlanStore((s) => s.upsertField);
  const { toast } = useToast();

  const [sourceColumn, setSourceColumn] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<PlanKind>("volume");
  const [direction, setDirection] = useState<PlanDirection>("higher");
  const [format, setFormat] = useState<CalculatedFieldFormat>("number");
  const [labelTouched, setLabelTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const options = useMemo(
    () => metricOptionsOf(dataset).filter((o) => o.name !== project.dateColumn),
    [dataset, project.dateColumn],
  );
  const usedColumns = new Set(
    project.fields.filter((f) => f.id !== field?.id).map((f) => f.sourceColumn),
  );

  useEffect(() => {
    if (!open) return;
    setSourceColumn(field?.sourceColumn ?? "");
    setLabel(field?.label ?? "");
    setKind(field?.kind ?? "volume");
    setDirection(field?.direction ?? "higher");
    setFormat(field?.format ?? "number");
    setLabelTouched(Boolean(field));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- форма сбрасывается только при открытии
  }, [open, field?.id]);

  function pickMetric(column: string) {
    setSourceColumn(column);
    // Умные дефолты из lib/plan — пользователь может поменять после выбора.
    const d = suggestPlanFieldDefaults(column);
    setKind(d.kind);
    setDirection(d.direction);
    setFormat(defaultFormat(dataset, column));
    if (!labelTouched) setLabel(suggestPlanFieldLabel(dataset, column));
  }

  const canSave = Boolean(sourceColumn && label.trim()) && !saving;

  async function onSubmit() {
    if (!canSave) return;
    setSaving(true);
    try {
      const sortOrder =
        field?.sortOrder ??
        project.fields.reduce((m, f) => Math.max(m, f.sortOrder), -1) + 1;
      await upsertField(project.id, {
        id: field?.id,
        label: label.trim(),
        sourceColumn,
        kind,
        direction,
        format,
        sortOrder,
      });
      toast({ title: field ? "Поле плана сохранено" : "Поле плана добавлено", variant: "success" });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Не удалось сохранить поле", description: errorText(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const columns = options.filter((o) => o.group === "column");
  const calculated = options.filter((o) => o.group === "calculated");

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{field ? "Поле плана" : "Новое поле плана"}</DialogTitle>
          <DialogDescription>
            Возьмите метрику датасета — колонку или вычисляемое поле. Тип и направление
            подставятся сами, их можно поменять.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Метрика датасета</Label>
            {options.length === 0 ? (
              <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-foreground">
                {dataset
                  ? "В датасете нет числовых колонок и вычисляемых полей."
                  : "Датасет проекта недоступен — метрики не загрузить."}
              </p>
            ) : (
              <Select value={sourceColumn} onValueChange={pickMetric}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите метрику" />
                </SelectTrigger>
                <SelectContent>
                  {columns.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Колонки</SelectLabel>
                      {columns.map((o) => (
                        <SelectItem key={`c-${o.name}`} value={o.name}>
                          {o.name}
                          {usedColumns.has(o.name) && (
                            <span className="ml-2 text-xs text-muted-foreground">уже в плане</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {calculated.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Вычисляемые поля</SelectLabel>
                      {calculated.map((o) => (
                        <SelectItem key={`f-${o.name}`} value={o.name}>
                          {o.name}
                          {usedColumns.has(o.name) && (
                            <span className="ml-2 text-xs text-muted-foreground">уже в плане</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan-field-label">Подпись</Label>
            <Input
              id="plan-field-label"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                setLabelTouched(true);
              }}
              placeholder="Например: Расход"
            />
            <p className="text-xs text-muted-foreground">
              Из подписи получатся поля «{label.trim() || "Подпись"} · план», «· выполнение %» и
              другие — их видно в конструкторе графиков.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Тип</Label>
            <div className="grid grid-cols-2 gap-2">
              {PLAN_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left transition-colors",
                    kind === k ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40",
                  )}
                >
                  <div className="text-sm font-medium">{KIND_LABEL[k]}</div>
                  <div className="text-xs text-muted-foreground">{KIND_HINT[k]}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Направление</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as PlanDirection)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_DIRECTIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {DIRECTION_LABEL[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Формат</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as CalculatedFieldFormat)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CALCULATED_FIELD_FORMAT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                      <span className="ml-2 text-xs text-muted-foreground">{o.example}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {direction === "target" && (
            <p className="text-xs text-muted-foreground">
              «Ближе к плану» — светофор ловит и недотрату, и перерасход: зелёный 95–105%.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={() => void onSubmit()} disabled={!canSave}>
            {saving && <Loader2 className="animate-spin" />}
            {field ? "Сохранить" : "Добавить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
