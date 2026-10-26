"use client";

import { useMemo, useState } from "react";
import type {
  CalculatedField,
  DatasetColumn,
  DatasetColumnType,
} from "@/lib/types";
import { DATASET_TYPE_LABELS, mapClickhouseType } from "@/lib/type-mapping";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Calculator, Pencil, Plus, RotateCcw, Sigma, Trash2 } from "lucide-react";
import { CalculatedFieldEditor } from "./CalculatedFieldEditor";
import {
  collectIdentifiers,
  computeAggregateFlags,
  parseFormula,
  prepareCalculatedFields,
} from "@/lib/formula";
import { CALCULATED_FIELD_FORMAT_OPTIONS } from "@/lib/format-value";

interface Props {
  columns: DatasetColumn[];
  onChange: (next: DatasetColumn[]) => void;
  /** Вычисляемые поля датасета — управляются прямо в этом же списке. */
  calculatedFields: CalculatedField[];
  onCalculatedFieldsChange: (next: CalculatedField[]) => void;
}

const TYPES: DatasetColumnType[] = [
  "integer",
  "float",
  "string",
  "category",
  "date",
  "datetime",
  "boolean",
];

export function ColumnConfigurator({
  columns,
  onChange,
  calculatedFields,
  onCalculatedFieldsChange,
}: Props) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const update = (idx: number, patch: Partial<DatasetColumn>) => {
    const next = columns.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const handleTypeChange = (idx: number, value: DatasetColumnType) => {
    const col = columns[idx];
    const auto = mapClickhouseType(col.clickhouseType);
    update(idx, { datasetType: value, isAutoDetected: value === auto });
  };

  const handleReset = (idx: number) => {
    const col = columns[idx];
    const auto = mapClickhouseType(col.clickhouseType);
    update(idx, { datasetType: auto, isAutoDetected: true });
  };

  // --- Вычисляемые поля (порт логики из CalculatedFieldsEditor) ---
  const editing = useMemo(
    () =>
      editingId
        ? calculatedFields.find((f) => f.id === editingId) ?? null
        : null,
    [editingId, calculatedFields],
  );

  const aggregateFlags = useMemo(
    () => computeAggregateFlags(prepareCalculatedFields(calculatedFields)),
    [calculatedFields],
  );

  const formatLabel = (f: CalculatedField) => {
    const opt = CALCULATED_FIELD_FORMAT_OPTIONS.find(
      (o) => o.value === (f.format ?? "number"),
    );
    return opt?.label ?? "Число";
  };

  const handleAddCalc = () => {
    setEditingId(null);
    setEditorOpen(true);
  };

  const handleEditCalc = (id: string) => {
    setEditingId(id);
    setEditorOpen(true);
  };

  const handleSaveCalc = (field: CalculatedField) => {
    const exists = calculatedFields.some((f) => f.id === field.id);
    if (exists) {
      onCalculatedFieldsChange(
        calculatedFields.map((f) => (f.id === field.id ? field : f)),
      );
    } else {
      onCalculatedFieldsChange([...calculatedFields, field]);
    }
  };

  const handleDeleteCalc = (field: CalculatedField) => {
    // Проверка зависимостей: упоминается ли поле в формулах других полей.
    const dependents: string[] = [];
    for (const other of calculatedFields) {
      if (other.id === field.id) continue;
      try {
        const ast = parseFormula(other.formula);
        const ids = collectIdentifiers(ast);
        if (ids.includes(field.name)) dependents.push(other.name);
      } catch {
        // невалидная формула не блокирует удаление
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
    onCalculatedFieldsChange(calculatedFields.filter((f) => f.id !== field.id));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Типы и включение столбцов. Вычисляемые поля (ARPU, ROI, CPI…) добавляются
        тут же — кнопкой внизу списка. Контекст для AI (бизнес, описание столбцов,
        воронка) задаётся в шаге «Контекст для AI» ниже.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Столбец</TableHead>
            <TableHead>Тип</TableHead>
            <TableHead className="w-20 text-right">Включён</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {columns.map((col, idx) => {
            const isOverridden = col.isAutoDetected === false;
            return (
              <TableRow key={col.name}>
                <TableCell className="font-mono text-xs align-top">
                  {col.name}
                </TableCell>
                <TableCell className="w-[240px] align-top">
                  <div className="flex items-start gap-1.5">
                    <Select
                      value={col.datasetType}
                      onValueChange={(v) =>
                        handleTypeChange(idx, v as DatasetColumnType)
                      }
                    >
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {DATASET_TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {isOverridden ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-brand-500"
                        title="Сбросить к автоопределённому"
                        onClick={() => handleReset(idx)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                    ClickHouse: {col.clickhouseType}
                  </div>
                </TableCell>
                <TableCell className="text-right align-top">
                  <Switch
                    checked={col.enabled}
                    onCheckedChange={(v) => update(idx, { enabled: v })}
                  />
                </TableCell>
              </TableRow>
            );
          })}

          {/* Вычисляемые поля — те же «столбцы», но из формул. */}
          {calculatedFields.length > 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={3}
                className="py-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary/80"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Calculator className="h-3 w-3" />
                  Вычисляемые поля
                </span>
              </TableCell>
            </TableRow>
          )}
          {calculatedFields.map((f) => (
            <TableRow key={f.id} className="bg-primary/[0.03]">
              <TableCell className="align-top">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs font-medium">{f.name}</span>
                  {aggregateFlags.get(f.name) ? (
                    <span
                      className="inline-flex items-center gap-0.5 rounded border border-primary/40 bg-primary/10 px-1 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-primary"
                      title="Aggregate-level: считается на уровне группы"
                    >
                      <Sigma className="h-2.5 w-2.5" />
                      AGG
                    </span>
                  ) : (
                    <span
                      className="rounded border border-border bg-secondary/50 px-1 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground"
                      title="Row-level: считается для каждой строки"
                    >
                      ROW
                    </span>
                  )}
                </div>
                <code className="mt-0.5 block max-w-[260px] truncate font-mono text-[10px] text-muted-foreground">
                  {f.formula}
                </code>
              </TableCell>
              <TableCell className="align-top">
                <span className="rounded border border-border bg-secondary/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {formatLabel(f)}
                </span>
              </TableCell>
              <TableCell className="align-top text-right">
                <div className="flex items-center justify-end gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleEditCalc(f.id)}
                    aria-label="Редактировать"
                    title="Редактировать формулу"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:text-destructive"
                    onClick={() => handleDeleteCalc(f)}
                    aria-label="Удалить"
                    title="Удалить поле"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Button
        type="button"
        variant="outline"
        className="w-full border-dashed border-primary/40 text-primary hover:bg-primary/5"
        onClick={handleAddCalc}
      >
        <Plus className="h-4 w-4" />
        Вычисляемое поле
        <span className="ml-1 rounded bg-primary/15 px-1 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-primary">
          fx
        </span>
      </Button>

      <CalculatedFieldEditor
        initial={editing}
        columns={columns}
        existing={calculatedFields}
        open={editorOpen}
        onOpenChange={(o) => {
          setEditorOpen(o);
          if (!o) setEditingId(null);
        }}
        onSave={handleSaveCalc}
      />
    </div>
  );
}
