"use client";

import { useMemo, useState } from "react";
import type { CalculatedField, DatasetColumn } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Calculator, Pencil, Plus, Sigma, Trash2 } from "lucide-react";
import { CalculatedFieldEditor } from "./CalculatedFieldEditor";
import {
  collectIdentifiers,
  computeAggregateFlags,
  parseFormula,
  prepareCalculatedFields,
} from "@/lib/formula";
import { CALCULATED_FIELD_FORMAT_OPTIONS } from "@/lib/format-value";

interface Props {
  fields: CalculatedField[];
  columns: DatasetColumn[];
  onChange: (next: CalculatedField[]) => void;
  /**
   * Заголовок и стиль карточки переключают «датасет» / «визуализация».
   * Не аффектит логику, только тексты.
   */
  variant?: "dataset" | "visualization";
}

export function CalculatedFieldsEditor({
  fields,
  columns,
  onChange,
  variant = "dataset",
}: Props) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = useMemo(
    () => (editingId ? fields.find((f) => f.id === editingId) ?? null : null),
    [editingId, fields],
  );

  // Какие поля aggregate-level (SUM/AVG/… в формуле или ссылка на агрегатное).
  const aggregateFlags = useMemo(
    () => computeAggregateFlags(prepareCalculatedFields(fields)),
    [fields],
  );

  const handleAdd = () => {
    setEditingId(null);
    setEditorOpen(true);
  };
  const handleEdit = (id: string) => {
    setEditingId(id);
    setEditorOpen(true);
  };

  const handleSave = (field: CalculatedField) => {
    const exists = fields.some((f) => f.id === field.id);
    if (exists) {
      onChange(fields.map((f) => (f.id === field.id ? field : f)));
    } else {
      onChange([...fields, field]);
    }
  };

  const handleDelete = (field: CalculatedField) => {
    // Проверка зависимостей: упоминается ли это поле в формулах
    // других вычисляемых полей этого же набора.
    const dependents: string[] = [];
    for (const other of fields) {
      if (other.id === field.id) continue;
      try {
        const ast = parseFormula(other.formula);
        const ids = collectIdentifiers(ast);
        if (ids.includes(field.name)) {
          dependents.push(other.name);
        }
      } catch {
        // ignore — невалидная формула не блокирует удаление
      }
    }
    if (dependents.length > 0) {
      const msg =
        `Поле "${field.name}" используется в других вычисляемых полях:\n` +
        `· ${dependents.join("\n· ")}\n\n` +
        `Если удалить — эти поля начнут возвращать «—».\n\nПродолжить?`;
      if (!confirm(msg)) return;
    } else {
      if (!confirm(`Удалить вычисляемое поле "${field.name}"?`)) return;
    }
    onChange(fields.filter((f) => f.id !== field.id));
  };

  const formatLabel = (f: CalculatedField) => {
    const opt = CALCULATED_FIELD_FORMAT_OPTIONS.find(
      (o) => o.value === (f.format ?? "number"),
    );
    return opt?.label ?? "Число";
  };

  return (
    <div className="space-y-3">
      {fields.length === 0 ? (
        <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 px-4 py-5 text-sm text-muted-foreground">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Calculator className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-foreground">
                {variant === "dataset"
                  ? "Пока нет вычисляемых полей"
                  : "Пока нет локальных вычисляемых полей"}
              </p>
              <p className="mt-1 text-xs leading-relaxed">
                {variant === "dataset"
                  ? "Соберите формулу из существующих столбцов — например, "
                  : "Они живут только внутри этой визуализации. Например, "}
                <code className="font-mono text-foreground">
                  SUM([revenue_rub]) / SUM([installs])
                </code>{" "}
                для <code className="font-mono text-foreground">ARPU</code>{" "}
                или{" "}
                <code className="font-mono text-foreground">
                  SUM([spend_rub]) / SUM([installs])
                </code>{" "}
                для <code className="font-mono text-foreground">CPI</code>.
                Для долей/ставок (ARPU, CPI, ROAS) делите{" "}
                <code className="font-mono text-foreground">СУММУ на СУММУ</code>,
                а не строку на строку — иначе при группировке получится сумма
                построчных дробей (неверно).
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {fields.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-3 rounded-md border border-border bg-card/60 px-3 py-2"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Calculator className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">
                    {f.name}
                  </span>
                  {aggregateFlags.get(f.name) ? (
                    <span
                      className="inline-flex items-center gap-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-brand-500 rounded border border-brand-500/40 bg-brand-500/10 px-1 py-0.5"
                      title="Aggregate-level: считается на уровне группы (агрегация внутри формулы)"
                    >
                      <Sigma className="h-2.5 w-2.5" />
                      AGG
                    </span>
                  ) : (
                    <span
                      className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground rounded border border-border bg-secondary/50 px-1 py-0.5"
                      title="Row-level: считается для каждой строки, агрегация — снаружи"
                    >
                      ROW
                    </span>
                  )}
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground rounded border border-border bg-secondary/50 px-1.5 py-0.5">
                    {formatLabel(f)}
                  </span>
                </div>
                <code className="block truncate font-mono text-[11px] text-muted-foreground mt-0.5">
                  {f.formula}
                </code>
                {f.description && (
                  <p className="truncate text-[11px] text-muted-foreground/80 mt-0.5 italic">
                    {f.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleEdit(f.id)}
                  aria-label="Редактировать"
                  title="Редактировать"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 hover:text-destructive"
                  onClick={() => handleDelete(f)}
                  aria-label="Удалить"
                  title="Удалить"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="gradient"
        className="w-full"
        onClick={handleAdd}
      >
        <Plus className="h-4 w-4" />
        Добавить вычисляемое поле
      </Button>

      <CalculatedFieldEditor
        initial={editing}
        columns={columns}
        existing={fields}
        open={editorOpen}
        onOpenChange={(o) => {
          setEditorOpen(o);
          if (!o) setEditingId(null);
        }}
        onSave={handleSave}
      />
    </div>
  );
}
