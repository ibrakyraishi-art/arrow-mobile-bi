"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, generateId } from "@/lib/utils";
import {
  findColumnType,
  inferFilterType,
} from "@/lib/dashboard-filters";
import type {
  CalculatedField,
  DashboardFilter,
  DashboardFilterType,
  Dataset,
} from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: Dataset;
  filters: DashboardFilter[];
  onSave: (filters: DashboardFilter[]) => Promise<void>;
}

export function ConfigureFiltersDialog({
  open,
  onOpenChange,
  dataset,
  filters,
  onSave,
}: Props) {
  const [local, setLocal] = useState<DashboardFilter[]>(filters);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setLocal(filters);
  }, [open, filters]);

  const availableColumns = [
    ...dataset.columns
      .filter((c) => c.enabled)
      .map((c) => ({ name: c.name, type: c.datasetType })),
    ...(dataset.calculatedFields ?? []).map((c: CalculatedField) => ({
      name: c.name,
      type: c.datasetType,
    })),
  ];

  function toggle(columnName: string) {
    const existing = local.find((f) => f.column === columnName);
    if (existing) {
      setLocal(local.filter((f) => f.column !== columnName));
      return;
    }
    const colType = findColumnType(dataset.columns, columnName);
    const calc = (dataset.calculatedFields ?? []).find(
      (c) => c.name === columnName,
    );
    const type = inferFilterType(colType ?? calc?.datasetType ?? "string");
    const filter: DashboardFilter = {
      id: generateId(),
      column: columnName,
      label: columnName,
      type,
    };
    setLocal([...local, filter]);
  }

  function updateFilter(id: string, patch: Partial<DashboardFilter>) {
    setLocal(local.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function removeFilter(id: string) {
    setLocal(local.filter((f) => f.id !== id));
  }

  function move(id: string, dir: -1 | 1) {
    const idx = local.findIndex((f) => f.id === id);
    if (idx === -1) return;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= local.length) return;
    const copy = local.slice();
    const [item] = copy.splice(idx, 1);
    copy.splice(nextIdx, 0, item);
    setLocal(copy);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(local);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  const selected = new Set(local.map((f) => f.column));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Глобальные фильтры дашборда</DialogTitle>
          <DialogDescription>
            Выберите столбцы датасета, которые появятся как фильтры сверху.
            Значения применяются ко всем виджетам на всех листах.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-hidden">
          <div className="flex flex-col gap-2 overflow-hidden">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Столбцы датасета
            </div>
            <div className="flex flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-card/30 p-2">
              {availableColumns.map((c) => {
                const checked = selected.has(c.name);
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => toggle(c.name)}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
                      checked && "bg-accent/60",
                    )}
                  >
                    <span className="font-mono truncate">{c.name}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {checked ? "✓" : c.type}
                    </span>
                  </button>
                );
              })}
              {availableColumns.length === 0 && (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  В датасете нет столбцов
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 overflow-hidden">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Активные фильтры ({local.length})
            </div>
            <div className="flex flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-card/30 p-2">
              {local.length === 0 && (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  Выберите столбцы слева
                </div>
              )}
              {local.map((f, idx) => (
                <div
                  key={f.id}
                  className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-card p-2"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-[11px] text-muted-foreground truncate">
                      {f.column}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={idx === 0}
                        onClick={() => move(f.id, -1)}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={idx === local.length - 1}
                        onClick={() => move(f.id, 1)}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        onClick={() => removeFilter(f.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <Input
                    value={f.label}
                    onChange={(e) =>
                      updateFilter(f.id, { label: e.target.value })
                    }
                    placeholder="Отображаемое название"
                    className="h-7 text-xs"
                  />
                  <Select
                    value={f.type}
                    onValueChange={(v) =>
                      updateFilter(f.id, { type: v as DashboardFilterType })
                    }
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="select">Select</SelectItem>
                      <SelectItem value="multi_select">Multi select</SelectItem>
                      <SelectItem value="date_range">Date range</SelectItem>
                      <SelectItem value="number_range">Number range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Отмена
          </Button>
          <Button variant="gradient" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
