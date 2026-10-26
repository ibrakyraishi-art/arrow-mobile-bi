"use client";

import { useState } from "react";
import { Eye, GripVertical, Lock, Plus, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { getGroupOptions } from "@/components/notifications/ConditionsEditor";
import type { Dataset } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  dataset: Dataset;
  groupBy: string[];
  /** Имена измерений, помеченных под маску (значения → коды). */
  maskedSet: Set<string>;
  onAdd: (col: string) => void;
  onRemove: (col: string) => void;
  onReorder: (next: string[]) => void;
  onToggleMask: (col: string, mask: boolean) => void;
}

/**
 * Зона ГРУППИРОВКА (строки сводной таблицы). Измерения — упорядоченные чипы:
 * перетаскиванием меняется порядок, у каждого — переключатель 👁/🔒 (открыто /
 * маскировать) и × (удалить). Маскировка задаётся ТОЛЬКО здесь, на полях
 * группировки. Без измерений в Claude уходят сырые строки (до 500).
 */
export function AiGroupingZone({
  dataset,
  groupBy,
  maskedSet,
  onAdd,
  onRemove,
  onReorder,
  onToggleMask,
}: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const available = getGroupOptions(dataset).filter(
    (o) => !groupBy.includes(o.name),
  );

  function move(from: number, to: number) {
    if (to < 0 || to >= groupBy.length || from === to) return;
    const next = groupBy.slice();
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    onReorder(next);
  }

  return (
    <div className="space-y-2">
      {groupBy.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-2.5 text-[11px] leading-snug text-muted-foreground">
          Измерения не выбраны — в Claude уйдут{" "}
          <b className="text-foreground">сырые строки</b> (до 500). Добавьте поля,
          чтобы получить <b className="text-foreground">сводную таблицу</b>.
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {groupBy.map((name, i) => {
            const masked = maskedSet.has(name);
            return (
              <span
                key={name}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragEnd={() => setDragIndex(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) move(dragIndex, i);
                  setDragIndex(null);
                }}
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg border bg-card py-0.5 pl-1 pr-1 font-mono text-xs",
                  masked
                    ? "border-warning/50 bg-warning/10"
                    : "border-primary/40 bg-primary/10",
                  dragIndex === i && "opacity-50",
                )}
              >
                <GripVertical className="h-3 w-3 cursor-grab text-faint" />
                <span className="text-[10px] text-faint">{i + 1}.</span>
                <span
                  className={masked ? "text-warning" : "text-primary"}
                >
                  {name}
                </span>
                <button
                  type="button"
                  onClick={() => onToggleMask(name, !masked)}
                  title={
                    masked
                      ? "🔒 Замаскировано: значения уходят в LLM кодами. Нажмите, чтобы открыть."
                      : "👁 Открыто: значения видит AI. Нажмите, чтобы замаскировать (токенизировать)."
                  }
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded transition-colors",
                    masked
                      ? "text-warning hover:bg-warning/20"
                      : "text-muted-foreground hover:bg-primary/15 hover:text-primary",
                  )}
                >
                  {masked ? (
                    <Lock className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(name)}
                  title="Убрать измерение"
                  className="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-destructive/15 hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {groupBy.some((c) => !maskedSet.has(c)) && (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            Чтобы скрыть значения поля от AI — нажмите{" "}
            <Eye className="inline h-3 w-3 align-[-2px] text-primary" /> у поля, оно
            станет{" "}
            <Lock className="inline h-3 w-3 align-[-2px] text-warning" />{" "}
            <span className="font-medium text-warning">замаскированным</span>{" "}
            (токенизация: в LLM уйдут коды вместо реальных значений).
          </span>
        </p>
      )}

      {available.length > 0 && (
        <Select value="" onValueChange={onAdd}>
          <SelectTrigger className="h-8 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Plus className="h-3.5 w-3.5" /> Добавить измерение
            </span>
          </SelectTrigger>
          <SelectContent>
            {available.map((c) => (
              <SelectItem key={c.name} value={c.name}>
                <span className="font-mono text-xs">{c.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {groupBy.some((c) => maskedSet.has(c)) && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-snug text-warning">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">Конфиденциальные поля защищены.</span>{" "}
            Значения полей с <Lock className="inline h-3 w-3 align-[-2px]" />{" "}
            токенизируются на сервере — в LLM уходят коды, а не реальные данные
            (в ответе коды заменяются обратно).
          </span>
        </div>
      )}
    </div>
  );
}
