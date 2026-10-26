"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { valueKey } from "@/lib/aggregation";
import { effectiveFilterValue } from "@/lib/dashboard-filters";
import { cn } from "@/lib/utils";
import { DateRangePicker, type DateRangeValue } from "./DateRangePicker";
import type {
  DashboardFilter,
  DataSource,
  Dataset,
  QueryResultRow,
} from "@/lib/types";

interface Props {
  filters: DashboardFilter[];
  activeFilters: Record<string, unknown>;
  dataset: Dataset;
  source: DataSource;
  onChange: (filterId: string, value: unknown) => void;
  onReset: () => void;
  /**
   * Узкий контейнер (напр. боковая панель AI-анализа ~340px): фильтры
   * выкладываются в столбец на всю ширину, длинные значения обрезаются.
   * По умолчанию — горизонтальный wrap (дашборды на всю ширину).
   */
  stack?: boolean;
}

export function GlobalFilters({
  filters,
  activeFilters,
  dataset,
  source,
  onChange,
  onReset,
  stack = false,
}: Props) {
  if (filters.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-center text-xs text-muted-foreground">
        Глобальные фильтры не настроены. Нажмите «Настроить фильтры», чтобы
        добавить.
      </div>
    );
  }

  const hasActive = Object.keys(activeFilters).some((k) => {
    const v = activeFilters[k];
    if (v === null || v === undefined || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") {
      const obj = v as { from?: unknown; to?: unknown };
      return (
        (obj.from !== undefined && obj.from !== "" && obj.from !== null) ||
        (obj.to !== undefined && obj.to !== "" && obj.to !== null)
      );
    }
    return true;
  });

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card/40 p-2.5",
        stack
          ? "flex flex-col items-stretch gap-2"
          : "flex flex-wrap items-end gap-2",
      )}
    >
      {filters.map((f) => (
        <FilterControl
          key={f.id}
          filter={f}
          value={effectiveFilterValue(f, activeFilters)}
          dataset={dataset}
          source={source}
          stack={stack}
          onChange={(v) => onChange(f.id, v)}
        />
      ))}
      <div className={cn("flex items-end", stack ? "w-full" : "ml-auto")}>
        <Button
          variant="outline"
          size="sm"
          onClick={onReset}
          disabled={!hasActive}
          className={cn("h-8 text-xs", stack && "w-full")}
          title="Сбросить все фильтры"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Сбросить все фильтры
        </Button>
      </div>
    </div>
  );
}

function FilterControl({
  filter,
  value,
  dataset,
  source,
  stack,
  onChange,
}: {
  filter: DashboardFilter;
  value: unknown;
  dataset: Dataset;
  source: DataSource;
  stack?: boolean;
  onChange: (v: unknown) => void;
}) {
  if (filter.type === "select") {
    return (
      <SingleSelectFilter
        filter={filter}
        value={typeof value === "string" ? value : ""}
        dataset={dataset}
        source={source}
        stack={stack}
        onChange={onChange}
      />
    );
  }
  if (filter.type === "multi_select") {
    return (
      <MultiSelectFilter
        filter={filter}
        value={Array.isArray(value) ? (value as string[]) : []}
        dataset={dataset}
        source={source}
        stack={stack}
        onChange={onChange}
      />
    );
  }
  if (filter.type === "date_range") {
    return (
      <DateRangePicker
        label={filter.label}
        value={value as DateRangeValue | undefined}
        stack={stack}
        onChange={(v) => onChange(v)}
      />
    );
  }
  return (
    <NumberRangeFilter
      filter={filter}
      value={value as { from?: string; to?: string } | undefined}
      dataset={dataset}
      source={source}
      stack={stack}
      onChange={onChange}
    />
  );
}

// ---------------------------------------------------------------------------
// Shared: distinct values loader.
// ---------------------------------------------------------------------------

function useDistinctValues(
  column: string,
  dataset: Dataset,
  source: DataSource,
): { values: string[]; loading: boolean } {
  const [values, setValues] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const res = await fetch("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataSourceId: dataset.dataSourceId,
            datasetId: dataset.id,
            table: dataset.table,
            sqlQuery: dataset.sqlQuery,
            source: {
              id: source.id,
              host: source.host,
              port: source.port,
              database: source.database,
              user: source.user,
              password: source.password,
              ssl: source.ssl,
              isDemo: source.isDemo,
            },
            chartType: "pivot",
            config: {
              rows: [column],
              columns: [],
              values: [],
              filters: [],
            },
            calculatedFields: dataset.calculatedFields ?? [],
          }),
        });
        const json = (await res.json()) as {
          data?: QueryResultRow[];
          error?: string;
        };
        if (cancelled) return;
        if (json.error) {
          setValues([]);
          return;
        }
        const raw = (json.data ?? [])
          .map((r) => r[column])
          .filter((v) => v !== null && v !== undefined)
          .map((v) => String(v));
        const unique = Array.from(new Set(raw)).sort();
        setValues(unique.slice(0, 1000));
      } catch {
        if (!cancelled) setValues([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [column, dataset, source]);

  return { values, loading };
}

// ---------------------------------------------------------------------------
// Shared: MIN/MAX bounds for a numeric column.
// ---------------------------------------------------------------------------

function useNumericBounds(
  column: string,
  dataset: Dataset,
  source: DataSource,
): { min: number | null; max: number | null } {
  const [bounds, setBounds] = useState<{ min: number | null; max: number | null }>({
    min: null,
    max: null,
  });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const res = await fetch("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataSourceId: dataset.dataSourceId,
            datasetId: dataset.id,
            table: dataset.table,
            sqlQuery: dataset.sqlQuery,
            source: {
              id: source.id,
              host: source.host,
              port: source.port,
              database: source.database,
              user: source.user,
              password: source.password,
              ssl: source.ssl,
              isDemo: source.isDemo,
            },
            chartType: "pivot",
            config: {
              rows: [],
              columns: [],
              values: [
                { column, aggregation: "MIN" },
                { column, aggregation: "MAX" },
              ],
              filters: [],
            },
            calculatedFields: dataset.calculatedFields ?? [],
          }),
        });
        const json = (await res.json()) as {
          data?: QueryResultRow[];
          error?: string;
        };
        if (cancelled || json.error) return;
        const row = json.data?.[0];
        if (!row) return;
        const rawMin = row[valueKey({ column, aggregation: "MIN" })];
        const rawMax = row[valueKey({ column, aggregation: "MAX" })];
        setBounds({
          min: typeof rawMin === "number" ? rawMin : rawMin === null || rawMin === undefined ? null : Number(rawMin),
          max: typeof rawMax === "number" ? rawMax : rawMax === null || rawMax === undefined ? null : Number(rawMax),
        });
      } catch {
        if (!cancelled) setBounds({ min: null, max: null });
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [column, dataset, source]);

  return bounds;
}

// ---------------------------------------------------------------------------
// Single select (DataLens-style: radio list + "Все" reset + search-if-large).
// ---------------------------------------------------------------------------

function SingleSelectFilter({
  filter,
  value,
  dataset,
  source,
  stack,
  onChange,
}: {
  filter: DashboardFilter;
  value: string;
  dataset: Dataset;
  source: DataSource;
  stack?: boolean;
  onChange: (v: unknown) => void;
}) {
  const { values, loading } = useDistinctValues(filter.column, dataset, source);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const showSearch = values.length > 10;
  const visibleValues = useMemo(() => {
    if (!search) return values;
    const q = search.toLowerCase();
    return values.filter((v) => v.toLowerCase().includes(q));
  }, [values, search]);

  const triggerLabel = value ? value : "Все";

  function pickValue(v: string) {
    onChange(v);
    setOpen(false);
    setSearch("");
  }

  function resetValue() {
    onChange("");
    setOpen(false);
    setSearch("");
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-0.5",
        stack ? "w-full min-w-0" : "min-w-[180px]",
      )}
    >
      <span className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {filter.label}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "h-8 justify-between gap-2 text-xs font-normal",
              !value && "text-muted-foreground",
            )}
          >
            <span className="min-w-0 truncate">{triggerLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[260px] p-1.5">
          {showSearch && (
            <div className="relative mb-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск…"
                className="h-7 pl-7 text-xs"
              />
            </div>
          )}
          <div className="max-h-[280px] overflow-y-auto">
            <RadioRow
              label="Все"
              checked={!value}
              onSelect={resetValue}
              italic
            />
            {loading ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                Загрузка…
              </div>
            ) : visibleValues.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                Нет значений
              </div>
            ) : (
              visibleValues.map((v) => (
                <RadioRow
                  key={v}
                  label={v}
                  checked={value === v}
                  onSelect={() => pickValue(v)}
                />
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function RadioRow({
  label,
  checked,
  italic,
  onSelect,
}: {
  label: string;
  checked: boolean;
  italic?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
        checked && "bg-accent/60",
      )}
    >
      <span
        className={cn(
          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
          checked ? "border-primary" : "border-border",
        )}
      >
        {checked && (
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        )}
      </span>
      <span
        className={cn(
          "truncate",
          italic ? "italic text-muted-foreground" : "font-mono",
        )}
      >
        {label}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Multi-select (DataLens-style: checkboxes + select all/clear + search + Apply).
// ---------------------------------------------------------------------------

function MultiSelectFilter({
  filter,
  value,
  dataset,
  source,
  stack,
  onChange,
}: {
  filter: DashboardFilter;
  value: string[];
  dataset: Dataset;
  source: DataSource;
  stack?: boolean;
  onChange: (v: unknown) => void;
}) {
  const { values, loading } = useDistinctValues(filter.column, dataset, source);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // «Черновик» выбора: правки внутри дропдауна применяются при ЗАКРЫТИИ
  // (кнопка «Применить» ИЛИ клик вне). Синхронизируем с применённым `value`
  // ТОЛЬКО в момент открытия (rising edge) — иначе ре-рендер родителя с новой
  // ссылкой `value` сбрасывал бы выбор прямо во время редактирования.
  const [staged, setStaged] = useState<string[]>(value);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setStaged(value);
      setSearch("");
    }
    wasOpen.current = open;
  }, [open, value]);

  const showSearch = values.length > 10;
  const visibleValues = useMemo(() => {
    if (!search) return values;
    const q = search.toLowerCase();
    return values.filter((v) => v.toLowerCase().includes(q));
  }, [values, search]);

  // На странице AI-анализа (stack) применяем выбор СРАЗУ по клику — без кнопки
  // «Применить»: каждый тогл сохраняет полный новый набор. Шлём весь набор, а не
  // дельту → даже при быстрых кликах побеждает последний (без гонок). В дашбордах
  // (не stack) остаётся «черновик» + коммит при закрытии — чтобы не перезапрашивать
  // виджеты на каждый клик. `normalizeSel`/`sameApplied` — function-декларации
  // (подняты), поэтому их можно звать выше по коду.
  function applyNow(next: string[]) {
    if (stack && !sameApplied(normalizeSel(next), value)) {
      onChange(normalizeSel(next));
    }
  }
  function toggle(v: string) {
    const next = staged.includes(v)
      ? staged.filter((x) => x !== v)
      : [...staged, v];
    setStaged(next);
    applyNow(next);
  }

  function selectAll() {
    setStaged(values);
    applyNow(values);
  }

  function clearAll() {
    setStaged([]);
    applyNow([]);
  }

  // Пустой массив и массив со всеми значениями трактуются одинаково — «все»
  // (фильтр не применяется). Нормализуем в пустой массив, чтобы
  // buildGlobalFilterConditions не генерил IN-клоз.
  function normalizeSel(sel: string[]): string[] {
    return values.length > 0 && sel.length === values.length ? [] : sel;
  }
  function sameApplied(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((x) => b.includes(x));
  }
  // Применяет «черновик». Зовётся при ЗАКРЫТИИ поповера (и кнопкой, и кликом
  // вне) — поэтому выбор не теряется, даже если юзер не нажал «Применить».
  // onChange дёргаем только если значение реально изменилось (без лишних
  // записей/перезапросов).
  function commit(sel: string[]) {
    const normalized = normalizeSel(sel);
    if (!sameApplied(normalized, value)) onChange(normalized);
  }

  const allSelected = value.length > 0 && value.length === values.length;
  const total = values.length;
  const selectedCount = value.length;

  const triggerLabel = useMemo(() => {
    if (selectedCount === 0 || allSelected) return "Все";
    if (selectedCount === 1) return value[0];
    return `${selectedCount} из ${total}`;
  }, [selectedCount, allSelected, total, value]);

  return (
    <div
      className={cn(
        "flex flex-col gap-0.5",
        stack ? "w-full min-w-0" : "min-w-[200px]",
      )}
    >
      <span className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {filter.label}
        {selectedCount > 0 && !allSelected && (
          <span className="ml-1 normal-case text-muted-foreground/80">
            ({selectedCount} из {total})
          </span>
        )}
      </span>
      <Popover
        open={open}
        onOpenChange={(o) => {
          if (!o) commit(staged); // применяем при закрытии (вкл. клик вне)
          setOpen(o);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-8 justify-between gap-2 text-xs font-normal"
          >
            <span className="min-w-0 truncate">{triggerLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[280px] p-0">
          <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
            <button
              type="button"
              onClick={selectAll}
              className="text-[11px] text-primary hover:underline"
            >
              Выбрать все
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
            >
              Снять все
            </button>
          </div>
          {showSearch && (
            <div className="relative border-b border-border p-1.5">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск…"
                className="h-7 pl-7 text-xs"
              />
            </div>
          )}
          <div className="max-h-[260px] overflow-y-auto p-1">
            {loading ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                Загрузка…
              </div>
            ) : visibleValues.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                Нет значений
              </div>
            ) : (
              visibleValues.map((v) => {
                const checked = staged.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => toggle(v)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
                      checked && "bg-accent/60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate font-mono">{v}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
            <span className="text-[11px] text-muted-foreground">
              {staged.length === 0 || staged.length === total
                ? "Все значения"
                : `${staged.length} из ${total}`}
            </span>
            <Button
              variant="gradient"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => {
                // ВАЖНО: применяем выбор явно. Radix не вызывает onOpenChange при
                // программном закрытии (через контролируемый `open`), поэтому
                // setOpen(false) сам по себе НЕ коммитил «черновик» — фильтр не
                // применялся по кнопке (только по клику вне). commit + закрытие.
                commit(staged);
                setOpen(false);
              }}
            >
              Применить
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Number range with min/max placeholders.
// ---------------------------------------------------------------------------

function NumberRangeFilter({
  filter,
  value,
  dataset,
  source,
  stack,
  onChange,
}: {
  filter: DashboardFilter;
  value: { from?: string; to?: string } | undefined;
  dataset: Dataset;
  source: DataSource;
  stack?: boolean;
  onChange: (v: unknown) => void;
}) {
  const { min, max } = useNumericBounds(filter.column, dataset, source);
  const from = value?.from ?? "";
  const to = value?.to ?? "";

  return (
    <div className={cn("flex flex-col gap-0.5", stack && "w-full min-w-0")}>
      <span className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {filter.label}
      </span>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          value={from}
          onChange={(e) => onChange({ from: e.target.value, to })}
          className={cn("h-8 text-xs", stack ? "min-w-0 flex-1" : "w-[120px]")}
          placeholder={min !== null ? `От ${min}` : "От"}
        />
        <span className="shrink-0 text-muted-foreground">—</span>
        <Input
          type="number"
          value={to}
          onChange={(e) => onChange({ from, to: e.target.value })}
          className={cn("h-8 text-xs", stack ? "min-w-0 flex-1" : "w-[120px]")}
          placeholder={max !== null ? `До ${max}` : "До"}
        />
      </div>
    </div>
  );
}
