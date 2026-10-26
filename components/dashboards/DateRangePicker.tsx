"use client";

import { useMemo, useState } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import { ru } from "date-fns/locale";
import {
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface DateRangeValue {
  from?: string;
  to?: string;
}

interface Props {
  label: string;
  value: DateRangeValue | undefined;
  onChange: (value: DateRangeValue) => void;
  /** Узкий контейнер: триггер на всю ширину, длинная подпись обрезается. */
  stack?: boolean;
}

function toISODate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function safeParse(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  try {
    const d = parseISO(iso);
    return isNaN(d.getTime()) ? undefined : d;
  } catch {
    return undefined;
  }
}

function formatLabel(iso: string | undefined): string {
  const d = safeParse(iso);
  if (!d) return "";
  return format(d, "dd.MM.yyyy");
}

interface Preset {
  label: string;
  build: () => DateRangeValue;
}

const PRESETS: Preset[] = [
  {
    label: "Сегодня",
    build: () => {
      const t = new Date();
      return { from: toISODate(t), to: toISODate(t) };
    },
  },
  {
    label: "Последние 7 дней",
    build: () => {
      const t = new Date();
      return { from: toISODate(subDays(t, 6)), to: toISODate(t) };
    },
  },
  {
    label: "Последние 30 дней",
    build: () => {
      const t = new Date();
      return { from: toISODate(subDays(t, 29)), to: toISODate(t) };
    },
  },
  {
    label: "Этот месяц",
    build: () => {
      const t = new Date();
      return {
        from: toISODate(startOfMonth(t)),
        to: toISODate(endOfMonth(t)),
      };
    },
  },
  {
    label: "Прошлый месяц",
    build: () => {
      const prev = subMonths(new Date(), 1);
      return {
        from: toISODate(startOfMonth(prev)),
        to: toISODate(endOfMonth(prev)),
      };
    },
  },
  {
    label: "Всё время",
    build: () => ({}),
  },
];

export function DateRangePicker({ label, value, onChange, stack }: Props) {
  const [open, setOpen] = useState(false);

  const range: DateRange | undefined = useMemo(() => {
    const from = safeParse(value?.from);
    const to = safeParse(value?.to);
    if (!from && !to) return undefined;
    return { from, to };
  }, [value]);

  const triggerLabel = useMemo(() => {
    const f = formatLabel(value?.from);
    const t = formatLabel(value?.to);
    if (!f && !t) return "Выбрать диапазон";
    if (f && t) return `${f} — ${t}`;
    if (f) return `с ${f}`;
    return `до ${t}`;
  }, [value]);

  function handleSelect(selected: DateRange | undefined) {
    if (!selected) {
      onChange({});
      return;
    }
    onChange({
      from: selected.from ? toISODate(selected.from) : undefined,
      to: selected.to ? toISODate(selected.to) : undefined,
    });
  }

  function handlePreset(preset: Preset) {
    onChange(preset.build());
    setOpen(false);
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-0.5",
        stack ? "w-full min-w-0" : "min-w-[220px]",
      )}
    >
      <span className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "h-8 justify-between gap-2 text-xs font-normal",
              !value?.from && !value?.to && "text-muted-foreground",
            )}
          >
            <span className="min-w-0 truncate">{triggerLabel}</span>
            <CalendarDays className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-auto p-0 overflow-hidden"
        >
          <div className="flex">
            <div className="flex min-w-[160px] flex-col gap-0.5 border-r border-border bg-muted/20 p-2">
              <div className="mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Быстрый выбор
              </div>
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => handlePreset(p)}
                  className="rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="p-2">
              <DayPicker
                mode="range"
                selected={range}
                onSelect={handleSelect}
                locale={ru}
                weekStartsOn={1}
                showOutsideDays
                classNames={dayPickerClassNames}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Кастомные классы для react-day-picker v9 (тёмная тема, accent-color).
const dayPickerClassNames: Partial<Record<string, string>> = {
  root: "p-1 text-sm text-foreground",
  months: "flex flex-col gap-2",
  month: "space-y-2",
  month_caption: "flex items-center justify-center h-8 relative",
  caption_label: "text-sm font-medium capitalize",
  nav: "flex items-center gap-1 absolute inset-x-0 top-0 justify-between px-1",
  button_previous:
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition",
  button_next:
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition",
  month_grid: "w-full border-collapse",
  weekdays: "flex",
  weekday:
    "h-8 w-8 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground",
  week: "flex w-full",
  day: "h-8 w-8 p-0 text-center",
  day_button:
    "inline-flex h-8 w-8 items-center justify-center rounded-md text-xs font-normal text-foreground hover:bg-accent hover:text-foreground transition-colors",
  selected:
    "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
  range_start:
    "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:rounded-r-none",
  range_end:
    "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:rounded-l-none",
  range_middle:
    "[&>button]:bg-primary/25 [&>button]:text-foreground [&>button]:rounded-none [&>button]:hover:bg-primary/35",
  today: "[&>button]:ring-1 [&>button]:ring-primary/50",
  outside: "text-muted-foreground/40",
  disabled: "opacity-40",
  hidden: "invisible",
};
