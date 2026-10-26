"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, GripVertical, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Упорядоченные чипы полей с возможностью менять порядок: перетаскиванием
 * (native HTML5 drag, десктоп) и стрелками ◀ ▶ (надёжно на мобильной ширине).
 * Клик по «×» убирает поле. Используется для уровней группировки (строк pivot).
 */
export function OrderableChips({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  if (value.length === 0) return null;

  function move(from: number, to: number) {
    if (to < 0 || to >= value.length || from === to) return;
    const next = value.slice();
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    onChange(next);
  }

  function remove(name: string) {
    onChange(value.filter((v) => v !== name));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((name, i) => (
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
            "inline-flex items-center gap-1 rounded-md border border-brand-500/40 bg-brand-500/10 px-1.5 py-0.5 font-mono text-xs text-brand-500",
            dragIndex === i && "opacity-50",
          )}
        >
          <GripVertical className="h-3 w-3 cursor-grab text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">{i + 1}.</span>
          <button
            type="button"
            onClick={() => move(i, i - 1)}
            disabled={i === 0}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="Левее"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <span>{name}</span>
          <button
            type="button"
            onClick={() => move(i, i + 1)}
            disabled={i === value.length - 1}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="Правее"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => remove(name)}
            className="hover:text-destructive"
            aria-label="Убрать"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
