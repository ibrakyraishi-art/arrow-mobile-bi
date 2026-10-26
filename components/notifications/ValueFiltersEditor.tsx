"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DEMO_SOURCE_ID } from "@/lib/demo-data";
import type { Dataset, FilterCondition } from "@/lib/types";

// «По значению» — ручной ввод с оператором сравнения.
const VALUE_OPERATORS: { value: FilterCondition["operator"]; label: string }[] = [
  { value: "=", label: "=" },
  { value: "!=", label: "≠" },
  { value: ">", label: ">" },
  { value: "<", label: "<" },
  { value: ">=", label: "≥" },
  { value: "<=", label: "≤" },
  { value: "contains", label: "содержит" },
];

function genId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Режим фильтра по оператору: `in` → «по строкам» (мультивыбор), иначе «по значению». */
function modeOf(f: FilterCondition): "rows" | "value" {
  return f.operator === "in" ? "rows" : "value";
}

/** Парсит value `in`-фильтра (JSON-массив или CSV) в массив строк. */
function parseList(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v));
  } catch {
    // not json
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Фильтры по полям. Для каждого фильтра пользователь сам выбирает:
 *   - «по значению» — оператор сравнения + ручной ввод (Источник = Meta);
 *   - «по строкам» — мультивыбор из реальных значений колонки (GEO ∈ {UAE, EG}).
 * Применяются ДО агрегации.
 */
export function ValueFiltersEditor({
  dataset,
  value,
  onChange,
}: {
  dataset: Dataset | undefined;
  value: FilterCondition[];
  onChange: (v: FilterCondition[]) => void;
}) {
  const columns = useMemo(() => {
    if (!dataset) return [] as string[];
    const cols = dataset.columns
      .filter((c) => c.enabled !== false)
      .map((c) => c.name);
    for (const cf of dataset.calculatedFields ?? []) cols.push(cf.name);
    return cols;
  }, [dataset]);

  function add() {
    onChange([
      ...value,
      { id: genId(), column: columns[0] ?? "", operator: "=", value: "" },
    ]);
  }
  function update(i: number, patch: Partial<FilterCondition>) {
    const next = value.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function remove(i: number) {
    onChange(value.filter((_, k) => k !== i));
  }

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          Необязательно. Отбирайте строки: «по значению» (Источник = Meta) или
          «по строкам» — выбрать конкретные значения из списка (GEO: UAE, EG).
        </div>
      )}

      {value.map((f, i) => (
        <FilterRow
          key={f.id}
          dataset={dataset}
          columns={columns}
          filter={f}
          onChange={(patch) => update(i, patch)}
          onRemove={() => remove(i)}
        />
      ))}

      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus />
        Фильтр
      </Button>
    </div>
  );
}

function FilterRow({
  dataset,
  columns,
  filter,
  onChange,
  onRemove,
}: {
  dataset: Dataset | undefined;
  columns: string[];
  filter: FilterCondition;
  onChange: (patch: Partial<FilterCondition>) => void;
  onRemove: () => void;
}) {
  const mode = modeOf(filter);

  function setMode(next: "rows" | "value") {
    if (next === mode) return;
    if (next === "rows") {
      onChange({ operator: "in", value: "[]" });
    } else {
      onChange({ operator: "=", value: "" });
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/10 p-2">
      <div className="space-y-1">
        <Label className="text-xs">Поле</Label>
        <Select
          value={filter.column}
          onValueChange={(v) => onChange({ column: v })}
        >
          <SelectTrigger className="h-9 w-[170px]">
            <SelectValue placeholder="Колонка" />
          </SelectTrigger>
          <SelectContent>
            {columns.map((c) => (
              <SelectItem key={c} value={c}>
                <span className="font-mono text-xs">{c}</span>
              </SelectItem>
            ))}
            {filter.column && !columns.includes(filter.column) && (
              <SelectItem value={filter.column}>
                <span className="font-mono text-xs">{filter.column}</span>
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Тип</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as "rows" | "value")}>
          <SelectTrigger className="h-9 w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="value">по значению</SelectItem>
            <SelectItem value="rows">по строкам</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "value" ? (
        <>
          <div className="space-y-1">
            <Label className="text-xs">Условие</Label>
            <Select
              value={filter.operator}
              onValueChange={(v) =>
                onChange({ operator: v as FilterCondition["operator"] })
              }
            >
              <SelectTrigger className="h-9 w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VALUE_OPERATORS.map((op) => (
                  <SelectItem key={op.value} value={op.value}>
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Значение</Label>
            <Input
              className="h-9 w-[180px]"
              value={filter.value}
              placeholder="Meta"
              onChange={(e) => onChange({ value: e.target.value })}
            />
          </div>
        </>
      ) : (
        <div className="space-y-1">
          <Label className="text-xs">Значения (из датасета)</Label>
          <RowsValuePicker
            dataset={dataset}
            column={filter.column}
            selected={parseList(filter.value)}
            onChange={(list) => onChange({ value: JSON.stringify(list) })}
          />
        </div>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label="Удалить фильтр"
      >
        <Trash2 />
      </Button>
    </div>
  );
}

/** Мультивыбор реальных значений колонки (подгружаются с датасета). */
function RowsValuePicker({
  dataset,
  column,
  selected,
  onChange,
}: {
  dataset: Dataset | undefined;
  column: string;
  selected: string[];
  onChange: (list: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  // Кэш по колонке, чтобы не дёргать API повторно при каждом открытии.
  const cacheRef = useRef<Map<string, string[]>>(new Map());
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Закрытие по клику вне и по Escape (список рисуем inline, без портала).
  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !dataset || !column) return;
    const cached = cacheRef.current.get(column);
    if (cached) {
      setOptions(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch("/api/dataset/distinct-values", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataSourceId: dataset.dataSourceId,
            table: dataset.table,
            sqlQuery: dataset.sqlQuery,
            isDemo: dataset.dataSourceId === DEMO_SOURCE_ID,
            column,
          }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? `HTTP ${res.status}`);
          setOptions([]);
          return;
        }
        const vals = (json.values as string[]) ?? [];
        cacheRef.current.set(column, vals);
        setOptions(vals);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, dataset, column]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(v: string) {
    onChange(
      selectedSet.has(v) ? selected.filter((x) => x !== v) : [...selected, v],
    );
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-[220px] items-center justify-between rounded-md border border-input bg-background px-2 text-left text-sm"
      >
        <span className={selected.length === 0 ? "text-muted-foreground" : ""}>
          {selected.length === 0
            ? "Выберите значения"
            : `Выбрано: ${selected.length}`}
        </span>
        <ChevronDown
          className={cn(
            "ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="mt-1 w-[260px] overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          <div className="border-b border-border p-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск значения…"
              className="h-8"
            />
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Загрузка значений…
              </div>
            ) : error ? (
              <div className="px-3 py-2 text-xs text-destructive">{error}</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {options.length === 0 ? "Нет значений" : "Ничего не найдено"}
              </div>
            ) : (
              filtered.map((o) => {
                const active = selectedSet.has(o);
                return (
                  <button
                    type="button"
                    key={o}
                    onClick={() => toggle(o)}
                    className={cn(
                      "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent",
                      active && "bg-accent/50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        active
                          ? "border-brand-500 bg-brand-500 text-background"
                          : "border-border",
                      )}
                    >
                      {active && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate font-mono text-xs">{o}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-between border-t border-border p-2 text-xs text-muted-foreground">
            <span>Выбрано: {selected.length}</span>
            <div className="flex items-center gap-3">
              {selected.length > 0 && (
                <button
                  type="button"
                  className="hover:text-foreground"
                  onClick={() => onChange([])}
                >
                  Очистить
                </button>
              )}
              <button
                type="button"
                className="font-medium text-brand-500 hover:text-brand-400"
                onClick={() => setOpen(false)}
              >
                Готово
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
