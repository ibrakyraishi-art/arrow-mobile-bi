"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calculator, Search, Sigma } from "lucide-react";
import type {
  CalculatedField,
  CalculatedFieldFormat,
  DatasetColumn,
} from "@/lib/types";
import { generateId, cn } from "@/lib/utils";
import {
  computeAggregateFlags,
  prepareCalculatedFields,
  validateFormula,
} from "@/lib/formula";
import { CALCULATED_FIELD_FORMAT_OPTIONS } from "@/lib/format-value";

const AGGREGATE_FUNCTIONS = ["SUM", "AVG", "COUNT", "MIN", "MAX"] as const;

interface Props {
  /** null = создание, объект = редактирование */
  initial: CalculatedField | null;
  /** Все столбцы датасета (включая отключённые — для возможного использования). */
  columns: DatasetColumn[];
  /**
   * Существующие вычисляемые поля (включая редактируемое — оно
   * исключается из проверки на уникальность по id, чтобы при правке
   * можно было оставить старое имя).
   */
  existing: CalculatedField[];
  /** Полупрозрачные имена «других вычисляемых полей» — для подсказок. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (field: CalculatedField) => void;
}

type Mode = "visual" | "formula";

const OPERATORS: Array<{ symbol: string; label: string }> = [
  { symbol: "+", label: "Сложение" },
  { symbol: "-", label: "Вычитание" },
  { symbol: "*", label: "Умножение" },
  { symbol: "/", label: "Деление" },
  { symbol: "(", label: "Скобка открыть" },
  { symbol: ")", label: "Скобка закрыть" },
];

export function CalculatedFieldEditor({
  initial,
  columns,
  existing,
  open,
  onOpenChange,
  onSave,
}: Props) {
  const isEdit = !!initial;
  const [mode, setMode] = useState<Mode>("formula");
  const [name, setName] = useState("");
  const [datasetType, setDatasetType] = useState<"float" | "integer">("float");
  const [format, setFormat] = useState<CalculatedFieldFormat>("number");
  const [description, setDescription] = useState("");
  const [formula, setFormula] = useState("");
  const [columnSearch, setColumnSearch] = useState("");
  const [constantInput, setConstantInput] = useState("");
  const formulaInputRef = useRef<HTMLTextAreaElement>(null);

  // Reset/seed at open
  useEffect(() => {
    if (!open) return;
    setMode("formula");
    setColumnSearch("");
    setConstantInput("");
    if (initial) {
      setName(initial.name);
      setDatasetType(initial.datasetType);
      setFormat(initial.format ?? "number");
      setDescription(initial.description ?? "");
      setFormula(initial.formula);
    } else {
      setName("");
      setDatasetType("float");
      setFormat("number");
      setDescription("");
      setFormula("");
    }
  }, [open, initial]);

  // Все доступные идентификаторы — сырые столбцы + другие вычисляемые
  // поля (исключая текущее редактируемое — нельзя ссылаться на самого
  // себя; парсер циклы не блокирует, но в demo это вернёт null).
  const availableIdents = useMemo(() => {
    const cols = columns.filter((c) => c.enabled).map((c) => c.name);
    const others = existing
      .filter((e) => !initial || e.id !== initial.id)
      .map((e) => e.name);
    return [...cols, ...others];
  }, [columns, existing, initial]);

  const calcNamesSet = useMemo(
    () =>
      new Set(
        existing
          .filter((e) => !initial || e.id !== initial.id)
          .map((e) => e.name),
      ),
    [existing, initial],
  );

  // Список колонок для палитр / автокомплита (отфильтрованный поиском)
  const filteredColumnNames = useMemo(() => {
    const q = columnSearch.trim().toLowerCase();
    if (!q) return availableIdents;
    return availableIdents.filter((n) => n.toLowerCase().includes(q));
  }, [availableIdents, columnSearch]);

  // Какие из других вычисляемых полей являются aggregate-level — нужно для
  // проверки транзитивности (поле, ссылающееся на агрегатное, тоже агрегатное)
  // и запрета микса уровней в формуле.
  const isAggregateRef = useMemo(() => {
    const others = existing.filter((e) => !initial || e.id !== initial.id);
    const flags = computeAggregateFlags(prepareCalculatedFields(others));
    return (name: string) => flags.get(name) === true;
  }, [existing, initial]);

  const validation = useMemo(() => {
    if (!formula.trim()) {
      return { ok: false, error: "Формула пустая" } as ReturnType<
        typeof validateFormula
      >;
    }
    return validateFormula(formula, availableIdents, isAggregateRef);
  }, [formula, availableIdents, isAggregateRef]);

  const nameError = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return "Имя обязательно";
    // Проверка на уникальность имени.
    const colNames = new Set(columns.map((c) => c.name));
    if (colNames.has(trimmed)) {
      return "Это имя уже занято обычным столбцом";
    }
    const dupCalc = existing.find(
      (e) => e.name === trimmed && (!initial || e.id !== initial.id),
    );
    if (dupCalc) return "Это имя уже занято другим вычисляемым полем";
    return null;
  }, [name, columns, existing, initial]);

  const canSave = !nameError && validation.ok;

  // ---- Visual constructor handlers ----
  const appendToken = (token: string) => {
    setFormula((prev) => {
      if (!prev) return token;
      // Автоматический пробел между токенами для читабельности
      const needSpace = !prev.endsWith(" ") && !token.startsWith(" ");
      return prev + (needSpace ? " " : "") + token;
    });
  };
  const appendColumn = (colName: string) => appendToken(`[${colName}]`);
  const appendOperator = (op: string) => appendToken(op);
  const appendFunction = (fn: string) => appendToken(`${fn}(`);
  const appendConstant = () => {
    const v = constantInput.trim();
    if (!v) return;
    if (Number.isNaN(Number(v))) return;
    appendToken(v);
    setConstantInput("");
  };
  const removeLast = () => {
    setFormula((prev) => {
      const trimmed = prev.replace(/\s+$/, "");
      if (!trimmed) return "";
      // Удаляем последний токен: либо `[...]`, либо число, либо оператор/слово
      if (trimmed.endsWith("]")) {
        const start = trimmed.lastIndexOf("[");
        if (start >= 0) return trimmed.slice(0, start).replace(/\s+$/, "");
      }
      const m = trimmed.match(/(\s*\S+)$/);
      if (m) return trimmed.slice(0, trimmed.length - m[0].length);
      return "";
    });
  };
  const clearAll = () => setFormula("");

  // ---- Formula mode: insert text into textarea at cursor ----
  const insertAtCursor = (text: string, fallbackAppend: () => void) => {
    const ta = formulaInputRef.current;
    if (!ta) {
      fallbackAppend();
      return;
    }
    const start = ta.selectionStart ?? formula.length;
    const end = ta.selectionEnd ?? formula.length;
    const before = formula.slice(0, start);
    const after = formula.slice(end);
    const next = before + text + after;
    setFormula(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = before.length + text.length;
      ta.setSelectionRange(pos, pos);
    });
  };
  const insertColumnIntoFormula = (colName: string) =>
    insertAtCursor(`[${colName}]`, () => appendColumn(colName));
  const insertFunctionIntoFormula = (fn: string) =>
    insertAtCursor(`${fn}(`, () => appendFunction(fn));

  function handleSave() {
    if (!canSave) return;
    const trimmedName = name.trim();
    const field: CalculatedField = {
      id: initial?.id ?? generateId(),
      name: trimmedName,
      formula: formula.trim(),
      datasetType,
      format,
      description: description.trim() || undefined,
      aiDescription: initial?.aiDescription,
    };
    onSave(field);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            {isEdit ? "Редактировать вычисляемое поле" : "Новое вычисляемое поле"}
          </DialogTitle>
          <DialogDescription>
            Создайте метрику на основе существующих столбцов. Например:{" "}
            <code className="font-mono text-foreground">
              SUM([revenue_rub]) / SUM([installs])
            </code>{" "}
            — ARPU. Для долей и ставок делите СУММУ на СУММУ, а не строку на
            строку — иначе при группировке сложатся построчные дроби (неверно).
          </DialogDescription>
        </DialogHeader>

        {/* --- Общие поля --- */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_180px] gap-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Имя поля
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ARPU"
              className={cn("h-9", nameError && "border-destructive/60")}
            />
            {nameError && (
              <p className="text-[11px] text-destructive">{nameError}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Тип результата
            </Label>
            <Select
              value={datasetType}
              onValueChange={(v) =>
                setDatasetType(v as "float" | "integer")
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="float">Дробное</SelectItem>
                <SelectItem value="integer">Целое</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Формат отображения
            </Label>
            <Select
              value={format}
              onValueChange={(v) =>
                setFormat(v as CalculatedFieldFormat)
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALCULATED_FIELD_FORMAT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <span className="flex items-center justify-between gap-3">
                      <span>{o.label}</span>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {o.example}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Описание (опционально)
          </Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Например: Доход на одну установку"
            className="h-9"
          />
        </div>

        {/* --- Переключатель режимов --- */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1">
          <button
            type="button"
            onClick={() => setMode("visual")}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              mode === "visual"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Визуальный конструктор
          </button>
          <button
            type="button"
            onClick={() => setMode("formula")}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              mode === "formula"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Формула (текст)
          </button>
        </div>

        {/* --- Тело режима --- */}
        {mode === "formula" ? (
          <FormulaMode
            formula={formula}
            setFormula={setFormula}
            availableIdents={availableIdents}
            calcNamesSet={calcNamesSet}
            columnSearch={columnSearch}
            setColumnSearch={setColumnSearch}
            filteredColumnNames={filteredColumnNames}
            insertColumnIntoFormula={insertColumnIntoFormula}
            insertFunctionIntoFormula={insertFunctionIntoFormula}
            formulaInputRef={formulaInputRef}
          />
        ) : (
          <VisualMode
            availableIdents={availableIdents}
            calcNamesSet={calcNamesSet}
            columnSearch={columnSearch}
            setColumnSearch={setColumnSearch}
            filteredColumnNames={filteredColumnNames}
            constantInput={constantInput}
            setConstantInput={setConstantInput}
            appendColumn={appendColumn}
            appendOperator={appendOperator}
            appendFunction={appendFunction}
            appendConstant={appendConstant}
            removeLast={removeLast}
            clearAll={clearAll}
            formula={formula}
            setFormula={setFormula}
          />
        )}

        {/* --- Сообщение об ошибке формулы --- */}
        {!validation.ok && formula.trim().length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {validation.unknown && validation.unknown.length > 0 ? (
              <div className="space-y-1">
                <p>
                  {validation.unknown.length === 1
                    ? `Колонка [${validation.unknown[0]}] не найдена в датасете.`
                    : `Колонки не найдены в датасете: ${validation.unknown
                        .map((c) => `[${c}]`)
                        .join(", ")}.`}
                </p>
                <p className="text-destructive/80">
                  Доступные:{" "}
                  <span className="font-mono">
                    {availableIdents.length > 0
                      ? availableIdents.join(", ")
                      : "— (у датасета не загружена структура колонок)"}
                  </span>
                </p>
              </div>
            ) : (
              validation.error
            )}
          </div>
        )}

        {/* --- Индикатор уровня поля (ROW / AGG) + предупреждение о транзитивности --- */}
        {validation.ok && formula.trim().length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {validation.isAggregate ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-brand-500/40 bg-brand-500/10 px-1.5 py-0.5 font-mono font-bold uppercase tracking-wider text-brand-500">
                <Sigma className="h-3 w-3" />
                AGG · уровень группы
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/50 px-1.5 py-0.5 font-mono font-bold uppercase tracking-wider text-muted-foreground">
                ROW · уровень строки
              </span>
            )}
            {validation.isAggregate && (
              <span className="text-muted-foreground">
                {validation.inheritedAggregate && validation.aggregateRefs?.length
                  ? `Поле «${name.trim() || "…"}» ссылается на агрегатное поле ${validation.aggregateRefs
                      .map((r) => `«${r}»`)
                      .join(", ")} и стало агрегатным.`
                  : "Считается на уровне группы (день / кампания), агрегация задаётся внутри формулы."}
              </span>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            variant="gradient"
            onClick={handleSave}
            disabled={!canSave}
          >
            {isEdit ? "Сохранить" : "Создать поле"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- режим «Формула» ----------

function FormulaMode({
  formula,
  setFormula,
  calcNamesSet,
  columnSearch,
  setColumnSearch,
  filteredColumnNames,
  insertColumnIntoFormula,
  insertFunctionIntoFormula,
  formulaInputRef,
}: {
  formula: string;
  setFormula: (s: string) => void;
  availableIdents: string[];
  calcNamesSet: Set<string>;
  columnSearch: string;
  setColumnSearch: (s: string) => void;
  filteredColumnNames: string[];
  insertColumnIntoFormula: (n: string) => void;
  insertFunctionIntoFormula: (fn: string) => void;
  formulaInputRef: React.RefObject<HTMLTextAreaElement>;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3">
      <div className="space-y-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Формула
        </Label>
        <Textarea
          ref={formulaInputRef}
          value={formula}
          onChange={(e) => setFormula(e.target.value)}
          placeholder="SUM([revenue_rub]) / SUM([spend_rub]) * 100   или   SUM([spend_rub]) / SUM([installs])"
          className="font-mono text-sm min-h-[110px]"
          spellCheck={false}
        />
        <p className="text-[11px] text-muted-foreground">
          Используй <code className="font-mono">[имя_столбца]</code> для
          вставки колонки, <code className="font-mono">+ - * /</code> и
          скобки <code className="font-mono">( )</code>. Деление на 0
          вернёт «—», ошибки не будет.{" "}
          <span className="text-foreground/80">
            Агрегатные функции <code className="font-mono">SUM AVG COUNT MIN MAX</code>{" "}
            делают поле «уровня группы»: например{" "}
            <code className="font-mono">SUM([cost]) / SUM([leads])</code> — дневной CPA.
          </span>
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Функции
        </Label>
        <div className="grid grid-cols-3 gap-1">
          {AGGREGATE_FUNCTIONS.map((fn) => (
            <Button
              key={fn}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => insertFunctionIntoFormula(fn)}
              className="h-7 px-1 font-mono text-[11px]"
              title={`Вставить ${fn}( — агрегат на уровне группы`}
            >
              {fn}(
            </Button>
          ))}
        </div>
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Доступные столбцы
        </Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={columnSearch}
            onChange={(e) => setColumnSearch(e.target.value)}
            placeholder="Поиск…"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="max-h-[200px] overflow-y-auto rounded-md border border-border bg-secondary/30 p-1.5 space-y-0.5">
          {filteredColumnNames.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-muted-foreground italic">
              Ничего не найдено
            </p>
          ) : (
            filteredColumnNames.map((n) => {
              const isCalc = calcNamesSet.has(n);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => insertColumnIntoFormula(n)}
                  className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs font-mono hover:bg-primary/10 hover:text-primary transition-colors"
                >
                  {isCalc && (
                    <Calculator className="h-3 w-3 text-primary shrink-0" />
                  )}
                  <span className="truncate">{n}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- режим «Визуальный конструктор» ----------

function VisualMode({
  calcNamesSet,
  columnSearch,
  setColumnSearch,
  filteredColumnNames,
  constantInput,
  setConstantInput,
  appendColumn,
  appendOperator,
  appendFunction,
  appendConstant,
  removeLast,
  clearAll,
  formula,
  setFormula,
}: {
  availableIdents: string[];
  calcNamesSet: Set<string>;
  columnSearch: string;
  setColumnSearch: (s: string) => void;
  filteredColumnNames: string[];
  constantInput: string;
  setConstantInput: (s: string) => void;
  appendColumn: (n: string) => void;
  appendOperator: (op: string) => void;
  appendFunction: (fn: string) => void;
  appendConstant: () => void;
  removeLast: () => void;
  clearAll: () => void;
  formula: string;
  setFormula: (s: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-3">
        {/* Колонки */}
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Столбцы
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={columnSearch}
              onChange={(e) => setColumnSearch(e.target.value)}
              placeholder="Поиск столбца…"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <div className="max-h-[160px] overflow-y-auto rounded-md border border-border bg-secondary/30 p-1.5 space-y-0.5">
            {filteredColumnNames.length === 0 ? (
              <p className="px-2 py-2 text-[11px] text-muted-foreground italic">
                Ничего не найдено
              </p>
            ) : (
              filteredColumnNames.map((n) => {
                const isCalc = calcNamesSet.has(n);
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => appendColumn(n)}
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs font-mono hover:bg-primary/10 hover:text-primary transition-colors"
                  >
                    {isCalc && (
                      <Calculator className="h-3 w-3 text-primary shrink-0" />
                    )}
                    <span className="truncate">{n}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Операторы, функции и числа */}
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Операторы и функции
          </Label>
          <div className="grid grid-cols-3 gap-1">
            {OPERATORS.map((o) => (
              <Button
                key={o.symbol}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => appendOperator(o.symbol)}
                className="h-9 font-mono text-base"
                title={o.label}
              >
                {o.symbol}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {AGGREGATE_FUNCTIONS.map((fn) => (
              <Button
                key={fn}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => appendFunction(fn)}
                className="h-8 px-1 font-mono text-[11px]"
                title={`${fn}( — агрегат на уровне группы`}
              >
                {fn}(
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Input
              value={constantInput}
              onChange={(e) => setConstantInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  appendConstant();
                }
              }}
              placeholder="Число (100, 0.7…)"
              className="h-9 text-xs flex-1"
              type="text"
              inputMode="decimal"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={appendConstant}
              disabled={!constantInput.trim() || Number.isNaN(Number(constantInput))}
              className="h-9 px-3 text-xs whitespace-nowrap"
            >
              Добавить
            </Button>
          </div>
        </div>
      </div>

      {/* Формула */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Формула
          </Label>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={removeLast}
              disabled={!formula.trim()}
              className="h-7 px-2 text-[11px]"
            >
              Удалить последнее
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={clearAll}
              disabled={!formula}
              className="h-7 px-2 text-[11px] hover:text-destructive"
            >
              Очистить
            </Button>
          </div>
        </div>
        <Textarea
          value={formula}
          onChange={(e) => setFormula(e.target.value)}
          placeholder="Кликайте по столбцам и операторам — формула соберётся здесь"
          className="font-mono text-sm min-h-[64px]"
          spellCheck={false}
        />
        <p className="text-[11px] text-muted-foreground">
          Текст формулы можно править руками — режимы синхронизированы.
        </p>
      </div>
    </div>
  );
}
