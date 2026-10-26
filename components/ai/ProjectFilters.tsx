"use client";

import { useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { GlobalFilters } from "@/components/dashboards/GlobalFilters";
import {
  findColumnType,
  inferFilterType,
} from "@/lib/dashboard-filters";
import { cn, generateId } from "@/lib/utils";
import type {
  DashboardFilter,
  DataSource,
  Dataset,
} from "@/lib/types";

interface Props {
  dataset: Dataset;
  source: DataSource;
  filtersConfig: DashboardFilter[];
  filterValues: Record<string, unknown>;
  onConfigChange: (filters: DashboardFilter[]) => void;
  onValueChange: (filterId: string, value: unknown) => void;
  onResetValues: () => void;
}

export function ProjectFilters({
  dataset,
  source,
  filtersConfig,
  filterValues,
  onConfigChange,
  onValueChange,
  onResetValues,
}: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");

  const columns = useMemo(() => {
    const cols = dataset.columns
      .filter((c) => c.enabled)
      .map((c) => ({ name: c.name, type: c.datasetType }));
    const calc = (dataset.calculatedFields ?? []).map((c) => ({
      name: c.name,
      type: c.datasetType,
    }));
    return [...cols, ...calc];
  }, [dataset]);

  const visibleColumns = useMemo(() => {
    if (!search.trim()) return columns;
    const q = search.toLowerCase();
    return columns.filter((c) => c.name.toLowerCase().includes(q));
  }, [columns, search]);

  const selected = new Set(filtersConfig.map((f) => f.column));

  function toggle(columnName: string) {
    if (selected.has(columnName)) {
      onConfigChange(filtersConfig.filter((f) => f.column !== columnName));
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
    onConfigChange([...filtersConfig, filter]);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[11px] text-muted-foreground">
          Применяются к данным перед отправкой в AI
        </p>
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 shrink-0 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Добавить фильтр
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[280px] p-0">
            <div className="border-b border-border p-1.5">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск столбца…"
                className="h-7 text-xs"
                autoFocus
              />
            </div>
            <div className="max-h-[280px] overflow-y-auto p-1">
              {visibleColumns.length === 0 ? (
                <div className="px-2 py-2 text-center text-xs text-muted-foreground">
                  Нет столбцов
                </div>
              ) : (
                visibleColumns.map((c) => {
                  const checked = selected.has(c.name);
                  return (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => toggle(c.name)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
                        checked && "bg-accent/60",
                      )}
                    >
                      <span className="flex items-center gap-2 min-w-0">
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
                        <span className="truncate font-mono">{c.name}</span>
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {c.type}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {filtersConfig.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-center text-xs text-muted-foreground">
          Фильтры не добавлены. Нажмите «Добавить фильтр» — без фильтров в
          AI уйдёт вся выборка из датасета.
        </div>
      ) : (
        <GlobalFilters
          filters={filtersConfig}
          activeFilters={filterValues}
          dataset={dataset}
          source={source}
          stack
          onChange={onValueChange}
          onReset={onResetValues}
        />
      )}
    </div>
  );
}
