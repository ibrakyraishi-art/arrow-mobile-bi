"use client";

import {
  AreaChart as AreaIcon,
  BarChart3,
  ChartBarDecreasing,
  ChartNoAxesCombined,
  LineChart as LineIcon,
  PieChart as PieIcon,
  TableProperties,
} from "lucide-react";
import type {
  CalculatedField,
  CalculatedFieldFormat,
  DatasetColumn,
  DatasetColumnType,
  PivotValueConfig,
  PlanField,
  QueryResultRow,
  VisualizationType,
} from "@/lib/types";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { comboValues as comboValuesOf, valueKey } from "@/lib/aggregation";
import { sortDataForXAxis } from "@/lib/sorting";
import { formatNumber } from "@/lib/utils";
import {
  formatCalculatedValue,
  formatDateAxis,
  formatDateTooltip,
  isIsoDateValue,
  isWideDateRange,
  resolveValueFormat,
  valueLabel,
  type LabelContext,
} from "@/lib/format-value";
import {
  trafficLightLabel,
  completionColumnLight,
  formatCompletionPercent,
  resolvePlanColumn,
} from "@/lib/plan";

/**
 * Палитра графиков Arrow Mobile — токены темы `--chart-1..8` (globals.css):
 * синий #1F5BFF, коралл #FF6751, сирень #A663B9, тёмно-синий / светлая сирень,
 * розовый, светло-синий, нейтральный. Значения свои для светлой и тёмной темы,
 * поэтому графики читаются на любом фоне.
 */
const CHART_PALETTE = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `hsl(var(--chart-${n}))`);

/** Цвет светофора — токены темы `--ok/--warn/--bad`. */
const LIGHT_COLOR = {
  ok: "--ok",
  warn: "--warn",
  bad: "--bad",
} as const;

export const CHART_TYPE_ICONS: Record<VisualizationType, typeof BarChart3> = {
  pivot: TableProperties,
  bar: BarChart3,
  line: LineIcon,
  area: AreaIcon,
  pie: PieIcon,
  combo: ChartNoAxesCombined,
  progress: ChartBarDecreasing,
};

interface Props {
  type: Exclude<VisualizationType, "pivot">;
  data: QueryResultRow[];
  /** Ось X (bar/line/area/pie/combo). */
  xAxis?: string;
  /** Мера (bar/line/area/pie). */
  yAxis?: PivotValueConfig;
  series?: string | null;
  /** Тип колонки X — нужен для хронологической сортировки (date/datetime). */
  xAxisType?: DatasetColumnType;
  /** combo: `values[0]` — столбцы, `values[1..]` — линии; progress — поля выполнения. */
  values?: PivotValueConfig[];
  /** progress: разрез (`rows[0]`), необязателен. */
  breakdown?: string | null;
  /** Вычисляемые поля и поля плана — формат значений в тултипах (₽/$/%). */
  calculatedFields?: CalculatedField[];
  /** Поля плана датасета — направление для светофора в progress. */
  planFields?: PlanField[];
  /** Формат значений, выбранный в визуализации (`config.valueFormats`). */
  valueFormats?: Record<string, CalculatedFieldFormat>;
  /** Колонки датасета — человеческие подписи в легендах и тултипах. */
  datasetColumns?: DatasetColumn[];
}

export function ChartRenderer({
  type,
  data,
  xAxis,
  yAxis,
  series,
  xAxisType,
  values,
  breakdown,
  calculatedFields,
  planFields,
  valueFormats,
  datasetColumns,
}: Props) {
  const formatOf = (v: PivotValueConfig) =>
    resolveValueFormat(v, { valueFormats, calculatedFields });
  const labelCtx: LabelContext = { datasetColumns, calculatedFields };

  if (type === "progress") {
    const vals = values ?? [];
    if (vals.length === 0) return <ChartEmptyState type={type} />;
    if (data.length === 0) return <ChartEmptyState type={type} reason="empty" />;
    return (
      <ProgressBars
        data={data}
        values={vals}
        breakdown={breakdown ?? null}
        planFields={planFields ?? []}
        labelCtx={labelCtx}
      />
    );
  }

  const comboValues = type === "combo" ? comboValuesOf({ values, yAxis }) : [];

  if (!xAxis || (type === "combo" ? comboValues.length === 0 : !yAxis)) {
    return <ChartEmptyState type={type} />;
  }

  if (data.length === 0) {
    return <ChartEmptyState type={type} reason="empty" />;
  }

  const yKey = yAxis ? valueKey(yAxis) : valueKey(comboValues[0]);

  // Когда есть серия — pivot data: одна строка на X-значение, столбцы — серии.
  const hasSeries = !!series && type !== "combo";
  const pivotedData: QueryResultRow[] = hasSeries
    ? (() => {
        const xValues = Array.from(
          new Set(data.map((r) => String(r[xAxis] ?? ""))),
        );
        const map = new Map<string, QueryResultRow>();
        for (const x of xValues) map.set(x, { [xAxis]: x });
        for (const r of data) {
          const xv = String(r[xAxis] ?? "");
          const sv = String(r[series!] ?? "");
          const target = map.get(xv);
          if (target) target[sv] = r[yKey] as number;
        }
        return Array.from(map.values());
      })()
    : data;

  // Универсальная сортировка по X — даты в хронологии, числа по числам,
  // остальное — локалезависимо (ru+en, numeric: true для «9 < 10»).
  const sortedData = sortDataForXAxis(pivotedData, xAxis, xAxisType);

  const seriesKeys: string[] = hasSeries
    ? Array.from(new Set(data.map((r) => String(r[series!] ?? "")))).slice(0, 8)
    : [yKey];

  // Формат значения по ключу ряда: у серий — формат меры оси Y.
  const keyFormat = new Map<string, CalculatedFieldFormat | undefined>();
  if (type === "combo") {
    for (const v of comboValues) keyFormat.set(valueKey(v), formatOf(v));
  } else if (yAxis) {
    const f = formatOf(yAxis);
    for (const k of seriesKeys) keyFormat.set(k, f);
  }
  const fmt = (value: unknown, key: string): string => {
    if (typeof value !== "number") return value === null || value === undefined ? "—" : String(value);
    const f = keyFormat.get(key);
    if (f) return formatCalculatedValue(value, f);
    return formatNumber(value, value % 1 === 0 ? 0 : 2);
  };
  // Подпись ряда: у одной меры — человеческое название поля, у серий — значение серии.
  const seriesName = (k: string): string =>
    hasSeries
      ? isIsoDateValue(k)
        ? formatDateTooltip(k)
        : k
      : yAxis && k === valueKey(yAxis)
        ? valueLabel(yAxis, labelCtx)
        : k;

  // Даты по X: на оси «02.10» («02.10.26» шире года, «окт 2026» для месяцев),
  // в тултипе «02.10.2026». Тип колонки date/datetime или значения вида ISO.
  const xValues = sortedData.map((r) => r[xAxis]);
  const xIsDate =
    xAxisType === "date" ||
    xAxisType === "datetime" ||
    (xValues.length > 0 && xValues.every((v) => v === null || v === undefined || isIsoDateValue(v)));
  const wideDates = xIsDate && isWideDateRange(xValues);
  const xTick = (v: unknown): string =>
    xIsDate ? formatDateAxis(v, { wide: wideDates }) : v === null || v === undefined ? "—" : String(v);
  const xLabel = (v: unknown): string =>
    xIsDate ? formatDateTooltip(v) : v === null || v === undefined ? "—" : String(v);

  const commonProps = {
    data: sortedData,
    margin: { top: 12, right: 24, left: 4, bottom: 4 },
  };

  // Тултип: фон поверхности, рамка 1px, числа по формату поля.
  const tooltipStyles = {
    contentStyle: {
      backgroundColor: "hsl(var(--popover))",
      border: "1px solid hsl(var(--border))",
      borderRadius: 4,
      fontSize: 12,
      boxShadow: "var(--shadow-card)",
      padding: "8px 12px",
    },
    labelStyle: {
      color: "hsl(var(--foreground))",
      fontWeight: 600,
      marginBottom: 4,
      fontSize: 12,
    },
    itemStyle: {
      color: "hsl(var(--foreground))",
      fontVariantNumeric: "tabular-nums" as const,
      fontSize: 12,
      padding: "1px 0",
    },
    formatter: (
      value: number | string,
      _name: string,
      item: { dataKey?: string | number | ((obj: unknown) => unknown) },
    ) => fmt(value, typeof item?.dataKey === "string" ? item.dataKey : yKey),
    // У круговой заголовка тултипа нет (label пустой) — «—» не рисуем.
    labelFormatter: (label: unknown) =>
      label === null || label === undefined || label === "" ? "" : xLabel(label),
  };

  const axisStyles = {
    stroke: "hsl(var(--muted-foreground))",
    fontSize: 11,
    tickLine: false,
    axisLine: { stroke: "hsl(var(--border))" },
    style: {
      fontVariantNumeric: "tabular-nums",
    } as React.CSSProperties,
  };
  // Компактные подписи оси Y в формате меры: «3,1 млн ₽», «25 тыс.», «120%».
  const axisFormat = keyFormat.get(type === "combo" ? valueKey(comboValues[0]) : yKey);
  const yTick = (v: number) => compactNumber(v, axisFormat);
  const xAxisProps = { ...axisStyles, tickFormatter: xTick, minTickGap: 12 };

  const grid = (
    <CartesianGrid
      strokeDasharray="3 3"
      stroke="hsl(var(--border))"
      strokeOpacity={0.6}
      vertical={false}
    />
  );
  const legend = (iconType: "rect" | "line" | "circle") => (
    <Legend
      verticalAlign="bottom"
      iconType={iconType}
      iconSize={10}
      wrapperStyle={{ fontSize: 12, paddingTop: 8, color: "hsl(var(--muted-foreground))" }}
    />
  );

  if (type === "pie") {
    // Pie использует первые 6 цветов палитры (без зелёного,
    // чтобы не имитировать «положительность»).
    const piePalette = CHART_PALETTE.slice(0, 6);
    const pieData = sortedData.map((r, i) => ({
      name: xLabel(r[xAxis]),
      value: Number(r[yKey]) || 0,
      fill: piePalette[i % piePalette.length],
    }));
    return (
      <ResponsiveContainer width="100%" height={420}>
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="45%"
            outerRadius={140}
            innerRadius={70}
            paddingAngle={2}
            stroke="hsl(var(--card))"
            strokeWidth={2}
          >
            {pieData.map((entry, i) => (
              <Cell key={i} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip
            {...tooltipStyles}
            formatter={(value: number | string) => fmt(value, yKey)}
          />
          {legend("circle")}
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (type === "combo") {
    const [barValue, ...lineValues] = comboValues;
    const barKey = valueKey(barValue);
    const maxAbs = (key: string) =>
      sortedData.reduce((m, r) => {
        const n = Number(r[key]);
        return Number.isFinite(n) ? Math.max(m, Math.abs(n)) : m;
      }, 0);
    const barMax = maxAbs(barKey);
    // Вторая ось — для линии, чей масштаб отличается от столбцов в 4+ раза.
    const onRight = (key: string) => {
      const m = maxAbs(key);
      if (barMax === 0 || m === 0) return false;
      return Math.max(barMax, m) / Math.min(barMax, m) >= 4;
    };
    const rightKeys = new Set(lineValues.map(valueKey).filter(onRight));
    // Каждая ось — в формате своих значений: левая — столбцов, правая — первой
    // линии на ней (установки без ₽, расход с ₽).
    const firstRight = lineValues.find((v) => rightKeys.has(valueKey(v)));
    const rightFormat = firstRight ? keyFormat.get(valueKey(firstRight)) : undefined;
    const rightTick = (v: number) => compactNumber(v, rightFormat);
    return (
      <ResponsiveContainer width="100%" height={420}>
        <ComposedChart {...commonProps}>
          <defs>
            <linearGradient id="comboBarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_PALETTE[0]} stopOpacity={0.95} />
              <stop offset="100%" stopColor={CHART_PALETTE[0]} stopOpacity={0.5} />
            </linearGradient>
          </defs>
          {grid}
          <XAxis dataKey={xAxis} {...xAxisProps} />
          <YAxis yAxisId="left" {...axisStyles} tickFormatter={yTick} />
          {rightKeys.size > 0 && (
            <YAxis
              yAxisId="right"
              orientation="right"
              {...axisStyles}
              tickFormatter={rightTick}
            />
          )}
          <Tooltip
            {...tooltipStyles}
            cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
          />
          {legend("rect")}
          <Bar
            yAxisId="left"
            dataKey={barKey}
            name={valueLabel(barValue, labelCtx)}
            fill="url(#comboBarGrad)"
            radius={[3, 3, 0, 0]}
            maxBarSize={36}
          />
          {lineValues.map((v, i) => {
            const k = valueKey(v);
            const color = CHART_PALETTE[(i + 1) % CHART_PALETTE.length];
            return (
              <Line
                key={k}
                yAxisId={rightKeys.has(k) ? "right" : "left"}
                type="monotone"
                dataKey={k}
                name={valueLabel(v, labelCtx)}
                stroke={color}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, stroke: color, fill: "hsl(var(--card))", strokeWidth: 2 }}
                connectNulls
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  if (type === "bar") {
    return (
      <ResponsiveContainer width="100%" height={420}>
        <BarChart {...commonProps}>
          <defs>
            {seriesKeys.map((_, i) => (
              <linearGradient
                key={i}
                id={`barGrad-${i}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor={CHART_PALETTE[i % CHART_PALETTE.length]}
                  stopOpacity={0.95}
                />
                <stop
                  offset="100%"
                  stopColor={CHART_PALETTE[i % CHART_PALETTE.length]}
                  stopOpacity={0.55}
                />
              </linearGradient>
            ))}
          </defs>
          {grid}
          <XAxis dataKey={xAxis} {...xAxisProps} />
          <YAxis {...axisStyles} tickFormatter={yTick} />
          <Tooltip
            {...tooltipStyles}
            cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
          />
          {legend("rect")}
          {seriesKeys.map((k, i) => (
            <Bar
              key={k}
              dataKey={k}
              name={seriesName(k)}
              fill={`url(#barGrad-${i})`}
              radius={[4, 4, 0, 0]}
              maxBarSize={48}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (type === "line") {
    return (
      <ResponsiveContainer width="100%" height={420}>
        <LineChart {...commonProps}>
          {grid}
          <XAxis dataKey={xAxis} {...xAxisProps} />
          <YAxis {...axisStyles} tickFormatter={yTick} />
          <Tooltip
            {...tooltipStyles}
            cursor={{ stroke: "hsl(var(--primary) / 0.4)", strokeWidth: 1 }}
          />
          {legend("line")}
          {seriesKeys.map((k, i) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              name={seriesName(k)}
              stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
              strokeWidth={i === 0 ? 2.5 : 2}
              dot={{ r: 3, strokeWidth: 0 }}
              activeDot={{
                r: 6,
                stroke: CHART_PALETTE[i % CHART_PALETTE.length],
                fill: "hsl(var(--card))",
                strokeWidth: 2,
              }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // area — градиентная заливка под линией.
  return (
    <ResponsiveContainer width="100%" height={420}>
      <AreaChart {...commonProps}>
        <defs>
          {seriesKeys.map((_, i) => (
            <linearGradient
              key={i}
              id={`areaGrad-${i}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor={CHART_PALETTE[i % CHART_PALETTE.length]}
                stopOpacity={0.55}
              />
              <stop
                offset="100%"
                stopColor={CHART_PALETTE[i % CHART_PALETTE.length]}
                stopOpacity={0.05}
              />
            </linearGradient>
          ))}
        </defs>
        {grid}
        <XAxis dataKey={xAxis} {...xAxisProps} />
        <YAxis {...axisStyles} tickFormatter={yTick} />
        <Tooltip
          {...tooltipStyles}
          cursor={{ stroke: "hsl(var(--primary) / 0.4)", strokeWidth: 1 }}
        />
        {legend("rect")}
        {seriesKeys.map((k, i) => (
          <Area
            key={k}
            type="monotone"
            dataKey={k}
            name={seriesName(k)}
            stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
            fill={`url(#areaGrad-${i})`}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** 3 100 000 → «3,1 млн», 25 000 → «25 тыс.» (+ ₽/$/% по формату) — для подписей осей. */
function compactNumber(v: number, format?: CalculatedFieldFormat): string {
  if (!Number.isFinite(v)) return "";
  const abs = Math.abs(v);
  const n =
    abs >= 1e9
      ? `${formatNumber(v / 1e9, 1)} млрд`
      : abs >= 1e6
        ? `${formatNumber(v / 1e6, 1)} млн`
        : abs >= 1e4
          ? `${formatNumber(v / 1e3, 0)} тыс.`
          : formatNumber(v, v % 1 === 0 ? 0 : 1);
  if (format === "currency_rub") return `${n} ₽`;
  if (format === "currency_usd") return `$${n}`;
  if (format === "percent") return `${n}%`;
  return n;
}

// ---------------------------------------------------------------------------
// Прогресс: горизонтальные полосы выполнения со светофором.
// ---------------------------------------------------------------------------

interface ProgressItem {
  key: string;
  label: string;
  /** Выполнение в процентах (88 = 88%). */
  pct: number | null;
  light: "ok" | "warn" | "bad" | null;
  /** Подпись светофора по направлению поля. */
  lightLabel?: string;
}

/** Полоса шкалы: до 100% и запас до 150% для перевыполнения. */
const PROGRESS_SCALE_MAX = 150;
const PROGRESS_ROW_LIMIT = 30;

function ProgressBars({
  data,
  values,
  breakdown,
  planFields,
  labelCtx,
}: {
  data: QueryResultRow[];
  values: PivotValueConfig[];
  breakdown: string | null;
  planFields: PlanField[];
  labelCtx: LabelContext;
}) {
  const itemOf = (row: QueryResultRow, v: PivotValueConfig, label: string, key: string): ProgressItem => {
    const raw = row[valueKey(v)];
    const n = raw === null || raw === undefined || raw === "" ? null : Number(raw);
    const pct = n !== null && Number.isFinite(n) ? n : null;
    const hit = resolvePlanColumn(v.column, planFields);
    const direction = hit?.field.direction ?? "higher";
    const light = completionColumnLight(pct, direction);
    return {
      key,
      label,
      pct,
      light,
      lightLabel: light ? trafficLightLabel(light, direction) : undefined,
    };
  };
  const labelOf = (v: PivotValueConfig) => {
    const hit = resolvePlanColumn(v.column, planFields);
    return hit ? hit.field.label : valueLabel(v, labelCtx);
  };

  // Без разреза — одна полоса на поле (итоговая строка).
  if (!breakdown) {
    const row = data[0] ?? {};
    const items = values.map((v, i) => itemOf(row, v, labelOf(v), `${v.column}-${i}`));
    return (
      <div className="space-y-3 py-1">
        {items.map((it) => (
          <ProgressRow key={it.key} item={it} />
        ))}
      </div>
    );
  }

  // С разрезом — по секции на поле, полоса на значение разреза (лучшие сверху).
  return (
    <div className="space-y-5 py-1">
      {values.map((v, vi) => {
        const items = data
          .map((row) => itemOf(row, v, formatDateTooltip(row[breakdown]), `${vi}-${String(row[breakdown])}`))
          .sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity))
          .slice(0, PROGRESS_ROW_LIMIT);
        return (
          <div key={`${v.column}-${vi}`} className="space-y-2.5">
            {values.length > 1 && (
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {labelOf(v)}
              </div>
            )}
            {items.map((it) => (
              <ProgressRow key={it.key} item={it} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ProgressRow({ item }: { item: ProgressItem }) {
  const token = item.light ? LIGHT_COLOR[item.light] : null;
  const color = token ? `hsl(var(${token}))` : "hsl(var(--muted-foreground))";
  const width =
    item.pct === null ? 0 : Math.max(0, Math.min(item.pct, PROGRESS_SCALE_MAX)) / PROGRESS_SCALE_MAX;
  const target = 100 / PROGRESS_SCALE_MAX;
  return (
    <div className="grid grid-cols-[minmax(80px,180px)_1fr_64px] items-center gap-3">
      <div className="truncate text-sm text-foreground" title={item.label}>
        {item.label}
      </div>
      <div
        className="relative h-3 rounded-[2px] bg-muted/60"
        title={item.lightLabel}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-[2px] transition-[width] duration-500"
          style={{
            width: `${width * 100}%`,
            background: token
              ? `linear-gradient(90deg, hsl(var(${token}) / 0.65), hsl(var(${token})))`
              : color,
          }}
        />
        {/* Отметка 100% плана */}
        <div
          className="absolute -inset-y-1 w-px bg-foreground/40"
          style={{ left: `${target * 100}%` }}
          title="100% плана"
        />
      </div>
      <div
        className="text-right text-sm font-semibold tabular-nums"
        style={{ color }}
      >
        {formatCompletionPercent(item.pct)}
      </div>
    </div>
  );
}

function ChartEmptyState({
  type,
  reason,
}: {
  type: Exclude<VisualizationType, "pivot">;
  reason?: "empty";
}) {
  const Icon = CHART_TYPE_ICONS[type] ?? BarChart3;
  const title = reason === "empty" ? "Нет данных" : "Здесь будет график";
  const hint =
    reason === "empty"
      ? "Запрос вернулся пустым. Проверьте фильтры и параметры датасета."
      : type === "combo"
        ? "Выберите ось X и значения: первое — столбцы, остальные — линии"
        : type === "progress"
          ? "Добавьте поля «· выполнение %» из группы «План»"
          : "Выберите оси X и Y в левой панели";
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/10 py-20 text-center">
      <Icon className="h-9 w-9 text-muted-foreground/40" aria-hidden />
      <div className="text-base font-medium text-foreground">{title}</div>
      <div className="max-w-xs text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
