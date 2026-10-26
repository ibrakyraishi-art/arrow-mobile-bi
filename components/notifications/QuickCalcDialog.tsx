"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useDatasetStore } from "@/stores/datasetStore";
import type { CalculatedField, CalculatedFieldFormat, Dataset } from "@/lib/types";
import {
  computeAggregateFlags,
  prepareCalculatedFields,
  validateFormula,
} from "@/lib/formula";
import { explainFormulaError } from "@/lib/formula-help";

const AGGREGATIONS = ["SUM", "AVG", "COUNT", "MIN", "MAX"] as const;

// Имя поля должно быть валидным SQL-идентификатором (как validateColumnName в
// /api/query): латинские буквы/цифры/подчёркивание, не с цифры, без пробелов.
// Иначе запрос падает «Недопустимое имя столбца».
const FIELD_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Приводит произвольное имя к валидному идентификатору: «cost per install» → «cost_per_install». */
function sanitizeFieldName(raw: string): string {
  let s = raw
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!s) s = "field";
  if (/^[0-9]/.test(s)) s = `_${s}`;
  return s;
}

/**
 * Быстрое добавление вычисляемого поля — в стиле конструктора формул Excel:
 * клик по колонке вставляет `[колонку]`, клик по агрегации — `SUM()` с курсором
 * внутри скобок. Живая валидация формулы. Сохраняет в dataset.calculatedFields.
 */
export function QuickCalcDialog({
  open,
  onOpenChange,
  dataset,
  onCreated,
  defaultName,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dataset: Dataset | undefined;
  onCreated: (cf: CalculatedField) => void;
  defaultName?: string;
  /** Если задано — редактируем существующее поле (по id), а не создаём новое. */
  editing?: CalculatedField | null;
}) {
  const { toast } = useToast();
  const updateDataset = useDatasetStore((s) => s.updateDataset);
  const [name, setName] = useState("");
  const [formula, setFormula] = useState("");
  const [datasetType, setDatasetType] =
    useState<CalculatedField["datasetType"]>("float");
  const [format, setFormat] = useState<CalculatedFieldFormat>("number");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setFormula(editing.formula);
      setDatasetType(editing.datasetType);
      setFormat(editing.format ?? "number");
    } else {
      setName(defaultName ?? "");
      setFormula("");
      setDatasetType("float");
      setFormat("number");
    }
  }, [open, defaultName, editing]);

  const rawColumns = useMemo(
    () => (dataset ? dataset.columns.map((c) => c.name) : []),
    [dataset],
  );
  const calcColumns = useMemo(
    () => (dataset?.calculatedFields ?? []).map((c) => c.name),
    [dataset],
  );
  const availableColumns = useMemo(
    () => [...rawColumns, ...calcColumns],
    [rawColumns, calcColumns],
  );

  // Какие из существующих вычисляемых полей — aggregate-level (SUM/AVG/…).
  // Нужно, чтобы поймать SUM([поле-агрегат]) → вложенный агрегат (ILLEGAL_AGGREGATION).
  // При редактировании исключаем само поле, чтобы оно не «ссылалось на себя».
  const isAggregateRef = useMemo(() => {
    const fields = (dataset?.calculatedFields ?? []).filter(
      (f) => !editing || f.id !== editing.id,
    );
    const prepared = prepareCalculatedFields(fields);
    const flags = computeAggregateFlags(prepared);
    return (n: string) => flags.get(n) === true;
  }, [dataset, editing]);

  const validation = useMemo(() => {
    if (!formula.trim()) return { ok: false, error: "" };
    return validateFormula(formula, availableColumns, isAggregateRef);
  }, [formula, availableColumns, isAggregateRef]);

  // Понятное объяснение ошибки + (если можно) автофикс.
  const formulaHelp = useMemo(() => {
    if (!formula.trim() || validation.ok) return null;
    return explainFormulaError(formula, availableColumns, isAggregateRef);
  }, [formula, validation.ok, availableColumns, isAggregateRef]);

  // Имена уже-агрегированных полей (для подсказки «используйте без SUM()»).
  const aggFieldNames = useMemo(() => {
    const fields = (dataset?.calculatedFields ?? []).filter(
      (f) => !editing || f.id !== editing.id,
    );
    const prepared = prepareCalculatedFields(fields);
    const flags = computeAggregateFlags(prepared);
    return fields.filter((f) => flags.get(f.name) === true).map((f) => f.name);
  }, [dataset, editing]);

  // Примеры сырых числовых колонок (для подсказки «можно оборачивать в SUM()»).
  const rawNumericExamples = useMemo(() => {
    if (!dataset) return [] as string[];
    return dataset.columns
      .filter(
        (c) => c.datasetType === "integer" || c.datasetType === "float",
      )
      .map((c) => c.name)
      .slice(0, 3);
  }, [dataset]);

  const nameTaken = useMemo(() => {
    if (!dataset) return false;
    // При редактировании собственное имя занятым не считаем.
    const all = new Set(
      availableColumns.filter((n) => !editing || n !== editing.name),
    );
    return all.has(name.trim());
  }, [dataset, availableColumns, name, editing]);

  // Имя-идентификатор: без пробелов и спецсимволов (иначе SQL-запрос отклонит
  // столбец). Считаем невалидным только непустое плохое имя.
  const nameInvalid = useMemo(() => {
    const n = name.trim();
    return n.length > 0 && !FIELD_NAME_RE.test(n);
  }, [name]);

  /** Вставляет текст в позицию курсора формулы; caretBack — отступ курсора от конца. */
  function insert(text: string, caretBack = 0) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? formula.length;
    const end = el?.selectionEnd ?? start;
    const next = formula.slice(0, start) + text + formula.slice(end);
    setFormula(next);
    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      const pos = start + text.length - caretBack;
      node.setSelectionRange(pos, pos);
    });
  }

  async function onSave() {
    if (!dataset) return;
    const trimmedName = name.trim();
    if (!trimmedName || !formula.trim()) {
      toast({ title: "Заполните имя и формулу", variant: "destructive" });
      return;
    }
    if (nameTaken) {
      toast({
        title: "Имя уже занято",
        description: "Выберите другое имя для поля",
        variant: "destructive",
      });
      return;
    }
    if (!FIELD_NAME_RE.test(trimmedName)) {
      toast({
        title: "Недопустимое имя поля",
        description:
          "Только латиница, цифры и «_» (без пробелов), не с цифры. Напр.: cpa_installs",
        variant: "destructive",
      });
      return;
    }
    if (!validation.ok) {
      toast({
        title: "Формула невалидна",
        description: validation.error,
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const cf: CalculatedField = {
        id:
          editing?.id ??
          (typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`),
        name: trimmedName,
        formula: formula.trim(),
        datasetType,
        format,
      };
      const existing = dataset.calculatedFields ?? [];
      const nextFields = editing
        ? existing.map((f) => (f.id === editing.id ? cf : f))
        : [...existing, cf];
      await updateDataset(dataset.id, { calculatedFields: nextFields });
      toast({
        title: editing
          ? `Поле «${trimmedName}» обновлено`
          : `Поле «${trimmedName}» добавлено в датасет`,
        variant: "success",
      });
      onCreated(cf);
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Не удалось сохранить поле",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Редактирование поля" : "Новое вычисляемое поле"}
          </DialogTitle>
          <DialogDescription>
            Сохранится в датасет «{dataset?.name ?? "—"}» и сразу станет доступно
            как метрика и плейсхолдер в сообщении.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cf-name">Имя поля</Label>
            <Input
              id="cf-name"
              placeholder="cpa, ctr, roas, …"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {nameTaken && name.trim() && (
              <p className="text-xs text-destructive">Имя уже занято</p>
            )}
            {nameInvalid && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-destructive">
                  Только латиница, цифры и «_» (без пробелов), не с цифры — иначе
                  запрос отклонит столбец.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setName(sanitizeFieldName(name))}
                  className="h-7 border-destructive/40 text-xs hover:border-destructive"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  Исправить: {sanitizeFieldName(name)}
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="cf-formula">Формула</Label>
            <Input
              id="cf-formula"
              ref={inputRef}
              placeholder="[cost] / [installs]"
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Например:{" "}
              <code className="rounded bg-muted px-1 font-mono">
                CPA = [cost] / [installs]
              </code>
            </p>
            {/* Постоянная подсказка про SUM(). */}
            <p className="text-[11px] text-muted-foreground">
              Поля, которые уже суммированы
              {aggFieldNames.length > 0 ? (
                <>
                  {" "}(
                  <span className="font-mono">
                    {aggFieldNames.slice(0, 3).join(", ")}
                  </span>
                  )
                </>
              ) : (
                <>
                  {" "}(например{" "}
                  <span className="font-mono">installs</span>,{" "}
                  <span className="font-mono">leads</span>)
                </>
              )}
              , используйте без <span className="font-mono">SUM()</span>. Сырые
              колонки
              {rawNumericExamples.length > 0 ? (
                <>
                  {" "}(
                  <span className="font-mono">
                    {rawNumericExamples.join(", ")}
                  </span>
                  )
                </>
              ) : (
                <>
                  {" "}(например <span className="font-mono">cost</span>,{" "}
                  <span className="font-mono">impressions</span>)
                </>
              )}{" "}
              можно оборачивать в <span className="font-mono">SUM()</span>.
            </p>
            {formula && validation.ok && (
              <p className="text-xs text-success">Формула валидна ✓</p>
            )}
            {formula && !validation.ok && formulaHelp && (
              <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                <p className="text-xs text-destructive">{formulaHelp.message}</p>
                {formulaHelp.fix && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setFormula(formulaHelp.fix as string)}
                    className="h-7 border-destructive/40 text-xs hover:border-destructive"
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    {formulaHelp.fixLabel ?? "Исправить автоматически"}
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Агрегации — клик вставляет SUM() с курсором внутри скобок. */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Агрегации (клик → вставит, затем выберите колонку)
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {AGGREGATIONS.map((agg) => (
                <button
                  key={agg}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(`${agg}()`, 1)}
                  className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs hover:border-brand-500 hover:text-brand-500"
                >
                  {agg}()
                </button>
              ))}
            </div>
          </div>

          {/* Колонки — клик вставляет [колонку] в позицию курсора. */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Колонки датасета (клик — вставить)
            </Label>
            {availableColumns.length === 0 ? (
              <p className="text-xs text-muted-foreground">Нет колонок</p>
            ) : (
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto overscroll-contain rounded-md border border-border bg-muted/20 p-2">
                {rawColumns.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insert(`[${c}]`)}
                    className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] hover:border-brand-500 hover:text-brand-500"
                  >
                    {c}
                  </button>
                ))}
                {calcColumns.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insert(`[${c}]`)}
                    className="inline-flex items-center gap-1 rounded border border-brand-500/40 bg-brand-500/10 px-1.5 py-0.5 font-mono text-[11px] text-brand-500 hover:border-brand-500"
                    title="Вычисляемое поле"
                  >
                    <span className="text-[9px]">ƒx</span>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Тип</Label>
              <Select
                value={datasetType}
                onValueChange={(v) =>
                  setDatasetType(v as CalculatedField["datasetType"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="float">Float (дробное)</SelectItem>
                  <SelectItem value="integer">Integer (целое)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Формат отображения</Label>
              <Select
                value={format}
                onValueChange={(v) => setFormat(v as CalculatedFieldFormat)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="number">Число</SelectItem>
                  <SelectItem value="integer">Целое</SelectItem>
                  <SelectItem value="currency_usd">$ USD</SelectItem>
                  <SelectItem value="currency_rub">₽ RUB</SelectItem>
                  <SelectItem value="percent">%</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Отмена
          </Button>
          <Button
            type="button"
            onClick={onSave}
            disabled={busy || !validation.ok || nameTaken || nameInvalid}
          >
            {busy ? (
              <>
                <Loader2 className="animate-spin" />
                Сохранение…
              </>
            ) : (
              "Сохранить"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
