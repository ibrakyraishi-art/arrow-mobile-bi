"use client";

import type { DatasetColumn, FilterCondition } from "@/lib/types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { generateId } from "@/lib/utils";

const OPERATORS: FilterCondition["operator"][] = [
  "=",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "contains",
];

export function FilterBuilder({
  columns,
  filters,
  onChange,
}: {
  columns: DatasetColumn[];
  filters: FilterCondition[];
  onChange: (f: FilterCondition[]) => void;
}) {
  const enabled = columns.filter((c) => c.enabled);

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Фильтры
      </div>
      {filters.map((f, idx) => (
        <div
          key={f.id}
          className="flex items-center gap-1 rounded-md border border-border bg-card/60 p-1.5"
        >
          <Select
            value={f.column}
            onValueChange={(v) => {
              const next = filters.slice();
              next[idx] = { ...f, column: v };
              onChange(next);
            }}
          >
            <SelectTrigger className="h-7 flex-1 text-[11px] font-mono">
              <SelectValue placeholder="поле" />
            </SelectTrigger>
            <SelectContent>
              {enabled.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  <span className="font-mono text-xs">{c.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={f.operator}
            onValueChange={(v) => {
              const next = filters.slice();
              next[idx] = {
                ...f,
                operator: v as FilterCondition["operator"],
              };
              onChange(next);
            }}
          >
            <SelectTrigger className="h-7 w-[80px] text-[11px] font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATORS.map((op) => (
                <SelectItem key={op} value={op} className="font-mono">
                  {op}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={f.value}
            placeholder="значение"
            onChange={(e) => {
              const next = filters.slice();
              next[idx] = { ...f, value: e.target.value };
              onChange(next);
            }}
            className="h-7 flex-1 text-xs"
          />
          <button
            type="button"
            onClick={() => onChange(filters.filter((x) => x.id !== f.id))}
            className="text-muted-foreground hover:text-destructive transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="w-full h-8 text-xs border-dashed"
        disabled={enabled.length === 0}
        onClick={() => {
          if (enabled.length === 0) return;
          onChange([
            ...filters,
            {
              id: generateId(),
              column: enabled[0].name,
              operator: "=",
              value: "",
            },
          ]);
        }}
      >
        <Plus className="h-3.5 w-3.5" />
        {enabled.length === 0 ? "Нет доступных полей" : "Добавить фильтр"}
      </Button>
    </div>
  );
}
