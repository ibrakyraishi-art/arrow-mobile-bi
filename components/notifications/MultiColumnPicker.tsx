"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { OrderableChips } from "./OrderableChips";

/**
 * Мульти-выбор колонок.
 *
 * variant="inline" (по умолчанию): чипы внутри триггера, клик по чипу — удалить.
 * variant="summary": триггер «Выбрано: N», выбранные — чипами ПОД полем
 *   с перетаскиванием порядка (OrderableChips).
 *
 * Список раскрывается ВНУТРИ потока (без портала) — это важно: внутри
 * Radix-диалога портал уезжает в <body>, вне зоны прокрутки диалога, и колесо
 * мыши там не работает (react-remove-scroll глушит wheel). Inline-панель
 * прокручивается колесом нормально, т.к. живёт в скролл-области шага.
 */
export function MultiColumnPicker({
  value,
  onChange,
  options,
  placeholder = "Выберите колонки",
  disabled,
  id,
  variant = "inline",
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: { name: string; hint?: string }[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  variant?: "inline" | "summary";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => new Set(value), [value]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  // Закрытие по клику вне компонента и по Escape.
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

  function toggle(name: string) {
    onChange(
      selected.has(name) ? value.filter((v) => v !== name) : [...value, name],
    );
  }

  function remove(name: string) {
    onChange(value.filter((v) => v !== name));
  }

  return (
    <div className="space-y-2" ref={rootRef}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-left text-sm",
          "focus:outline-none focus:ring-2 focus:ring-ring",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        {variant === "summary" ? (
          <span className={value.length === 0 ? "text-muted-foreground" : ""}>
            {value.length === 0 ? placeholder : `Выбрано полей: ${value.length}`}
          </span>
        ) : value.length === 0 ? (
          <span className="text-muted-foreground">{placeholder}</span>
        ) : (
          value.map((name) => (
            <span
              key={name}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                remove(name);
              }}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-brand-500/40 bg-brand-500/10 px-1.5 py-0.5 font-mono text-xs text-brand-500 hover:border-brand-500"
              title="Убрать"
            >
              {name}
              <X className="h-3 w-3" />
            </span>
          ))
        )}
        <ChevronDown
          className={cn(
            "ml-auto h-4 w-4 shrink-0 opacity-50 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          <div className="border-b border-border p-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск колонки…"
              className="h-8"
            />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                Ничего не найдено
              </div>
            ) : (
              filtered.map((o) => {
                const active = selected.has(o.name);
                return (
                  <button
                    type="button"
                    key={o.name}
                    onClick={() => toggle(o.name)}
                    className={cn(
                      "flex w-full items-start gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent",
                      active && "bg-accent/50",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        active
                          ? "border-brand-500 bg-brand-500 text-background"
                          : "border-border",
                      )}
                    >
                      {active && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-xs">{o.name}</span>
                      {o.hint && (
                        <span
                          className="line-clamp-2 text-[11px] text-muted-foreground"
                          title={o.hint}
                        >
                          {o.hint}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-between border-t border-border p-2 text-xs text-muted-foreground">
            <span>Выбрано: {value.length}</span>
            <div className="flex items-center gap-3">
              {value.length > 0 && (
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

      {variant === "summary" && value.length > 0 && (
        <OrderableChips value={value} onChange={onChange} />
      )}
    </div>
  );
}
