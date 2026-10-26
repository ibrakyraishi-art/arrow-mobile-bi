"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCalculatedValue } from "@/lib/format-value";
import { cn } from "@/lib/utils";
import type { PlanSummaryField, PlanSummaryState } from "./summary";
import { addMonths, formatCompletionPercent, trafficLightLabel } from "@/lib/plan";
import { DIRECTION_LABEL, LightDot, lightText, monthTitle } from "./plan-ui";

interface Props {
  month: string;
  onMonthChange: (month: string) => void;
  summary: PlanSummaryState;
  /** Полей в проекте нет — отчёт пуст по определению. */
  hasFields: boolean;
}

/** Отчёт месяца по сводке `/api/plan/[id]/summary`: карточка на поле + мини-график по дням. */
export function PlanReport({ month, onMonthChange, summary, hasFields }: Props) {
  const { data, loading, error, reload } = summary;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onMonthChange(addMonths(month, -1))}
            aria-label="Предыдущий месяц"
          >
            <ChevronLeft />
          </Button>
          <div className="min-w-[150px] text-center text-sm font-medium capitalize">
            {monthTitle(month)}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onMonthChange(addMonths(month, 1))}
            aria-label="Следующий месяц"
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {data && data.month === month && (
            <span>
              Прошло {data.daysElapsed} из {data.daysInMonth} дн. · данные на {data.today}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={reload} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Обновить
          </Button>
        </div>
      </div>

      {!hasFields ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Отчёт появится, когда в проекте будет хотя бы одно поле плана.
        </div>
      ) : error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
          <span className="flex items-center gap-2 text-foreground">
            <AlertTriangle className="h-4 w-4 text-bad" />
            Не удалось получить отчёт: {error}
          </span>
          <Button variant="outline" size="sm" onClick={reload}>
            Повторить
          </Button>
        </div>
      ) : !data || (loading && data.month !== month) ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[300px] rounded-md" />
          ))}
        </div>
      ) : (
        <>
          {data.error && (
            <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              <span>
                Источник данных недоступен — факт не посчитан. {data.error}
              </span>
            </div>
          )}
          <div
            className={cn(
              "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3",
              loading && "opacity-60 transition-opacity",
            )}
          >
            {data.fields.map((f) => (
              <FieldCard key={f.fieldId} field={f} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FieldCard({ field: f }: { field: PlanSummaryField }) {
  const fmt = (v: number | null) => formatCalculatedValue(v, f.format);
  const isVolume = f.kind === "volume";
  const noPlan = f.plan === null;

  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="tile-gradient flex items-start justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{f.label}</div>
          <div className="text-[11px] opacity-80">
            {DIRECTION_LABEL[f.direction]} · {isVolume ? "темп с начала месяца" : "целевой уровень"}
          </div>
          <div
            className="mt-1 text-4xl font-bold tabular-nums leading-none"
            title={
              isVolume
                ? "Выполнение: факт с начала месяца ÷ план на сегодняшнюю дату"
                : "Выполнение: фактический уровень ÷ плановый уровень"
            }
          >
            {formatCompletionPercent(f.completion === null ? null : f.completion * 100)}
          </div>
        </div>
        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-card px-2 py-0.5 text-[11px] font-medium">
          <LightDot light={f.light} />
          <span className={lightText(f.light)}>
            {f.light ? trafficLightLabel(f.light, f.direction) : noPlan ? "нет плана" : "нет данных"}
          </span>
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-3 text-xs">
        <Stat label="План на месяц" value={fmt(f.plan)} />
        <Stat
          label="План на дату"
          value={fmt(f.planToDate)}
          hint="Часть месячного плана, приходящаяся на прошедшие дни месяца"
        />
        <Stat label="Факт" value={fmt(f.fact)} strong />
        <Stat
          label="Отклонение"
          hint="Факт минус план на дату"
          value={f.deviation !== null && f.deviation > 0 ? `+${fmt(f.deviation)}` : fmt(f.deviation)}
        />
        {isVolume && (
          <Stat
            label="Прогноз на конец месяца"
            value={fmt(f.forecast)}
            hint="Если темп сохранится: факт ÷ план на дату × план на месяц"
            wide
          />
        )}
      </dl>

      <div className="mt-auto border-t border-border px-2 pb-2 pt-1">
        <DailyChart field={f} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  strong,
  wide,
  hint,
}: {
  label: string;
  value: string;
  strong?: boolean;
  wide?: boolean;
  hint?: string;
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")} title={hint}>
      <dt className={cn("text-muted-foreground", hint && "cursor-help underline decoration-dotted underline-offset-2")}>
        {label}
      </dt>
      <dd className={cn("truncate tabular-nums text-sm", strong ? "font-semibold" : "text-foreground")}>
        {value}
      </dd>
    </div>
  );
}

const tooltipStyle = {
  contentStyle: {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 4,
    fontSize: 11,
    boxShadow: "var(--shadow-card)",
    padding: "6px 10px",
  },
  labelStyle: { color: "hsl(var(--foreground))", fontWeight: 600, fontSize: 11 },
  itemStyle: { color: "hsl(var(--foreground))", fontSize: 11 },
};

/** Мини-график по дням: факт столбцами, план линией (цвета — токены темы). */
function DailyChart({ field: f }: { field: PlanSummaryField }) {
  const rows = f.daily.map((d) => ({ day: d.date.slice(8, 10), date: d.date, fact: d.fact, plan: d.plan }));
  if (rows.length === 0) {
    return <div className="py-6 text-center text-[11px] text-muted-foreground">Нет данных по дням</div>;
  }
  const fmt = (v: unknown) =>
    typeof v === "number" ? formatCalculatedValue(v, f.format) : String(v ?? "—");
  return (
    <div className="h-[110px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={12}
          />
          <YAxis hide />
          <Tooltip
            {...tooltipStyle}
            cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
            labelFormatter={(_, p) => String(p?.[0]?.payload?.date ?? "")}
            formatter={(v: unknown, name: string) => [fmt(v), name]}
          />
          <Bar dataKey="fact" name="Факт" fill="hsl(var(--chart-1))" radius={[2, 2, 0, 0]} maxBarSize={14} />
          <Line
            dataKey="plan"
            name="План"
            type="monotone"
            stroke="hsl(var(--chart-2))"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
