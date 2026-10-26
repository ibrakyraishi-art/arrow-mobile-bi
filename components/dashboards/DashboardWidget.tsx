"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  TableProperties,
  Hash,
  Type,
  Pencil,
  Trash2,
  Loader2,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PivotTable } from "@/components/visualization/PivotTable";
import {
  CHART_TYPE_ICONS,
  ChartRenderer,
} from "@/components/visualization/ChartRenderer";
import { usePlanForDataset } from "@/components/visualization/usePlanForDataset";
import { isDemoObjectId } from "@/lib/demo-data";
import { Sparkline } from "@/components/dashboards/showcase/charts";
import { cn, formatNumber } from "@/lib/utils";
import { valueKey } from "@/lib/aggregation";
import { formatCalculatedValue, resolveValueFormat, valueLabel } from "@/lib/format-value";
import { readApiJson } from "@/lib/api-json";
import {
  trafficLightLabel,
  completionColumnLight,
  formatCompletionPercent,
  planColumnName,
  resolvePlanColumn,
} from "@/lib/plan";
import type {
  CalculatedFieldFormat,
  DashboardWidget,
  DashboardWidgetWidth,
  Dataset,
  DataSource,
  FilterCondition,
  MetricWidgetConfig,
  PivotValueConfig,
  QueryResultRow,
  TextWidgetConfig,
  Visualization,
  VisualizationConfig,
  VisualizationType,
} from "@/lib/types";

const CHART_ICONS: Record<string, typeof BarChart3> = CHART_TYPE_ICONS;

/** Подпись под цифрой метрики (шаблон план/факт кладёт её в `config.caption`). */
interface MetricCaption {
  column: string;
  aggregation: PivotValueConfig["aggregation"];
  label: string;
  format?: CalculatedFieldFormat | "currency";
}

interface Props {
  widget: DashboardWidget;
  dataset: Dataset;
  source: DataSource;
  visualization?: Visualization;
  globalFilters: FilterCondition[];
  editing: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onChangeWidth?: (w: DashboardWidgetWidth) => void;
}

export function DashboardWidgetCard({
  widget,
  dataset,
  source,
  visualization,
  globalFilters,
  editing,
  onEdit,
  onDelete,
  onChangeWidth,
}: Props) {
  const widthClass = widthToClass(widget.width);

  return (
    <div className={cn("flex", widthClass)}>
      <Card className="flex flex-1 flex-col overflow-hidden">
        <CardContent className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <WidgetIcon widget={widget} vizType={visualization?.type} />
              <h3 className="text-sm font-semibold truncate">
                {widget.title || "—"}
              </h3>
            </div>
            {editing && (
              <div className="flex items-center gap-1">
                <Select
                  value={widget.width}
                  onValueChange={(v) =>
                    onChangeWidth?.(v as DashboardWidgetWidth)
                  }
                >
                  <SelectTrigger className="h-7 w-[92px] text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full</SelectItem>
                    <SelectItem value="half">Half</SelectItem>
                    <SelectItem value="third">Third</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onEdit}
                  title="Настроить"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={onDelete}
                  title="Удалить"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
          <div className="flex-1">
            <WidgetBody
              widget={widget}
              dataset={dataset}
              source={source}
              visualization={visualization}
              globalFilters={globalFilters}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function widthToClass(w: DashboardWidgetWidth): string {
  if (w === "full") return "w-full";
  if (w === "half") return "w-full md:w-[calc(50%-0.5rem)]";
  return "w-full md:w-[calc(33.333%-0.6667rem)]";
}

function WidgetIcon({
  widget,
  vizType,
}: {
  widget: DashboardWidget;
  vizType?: VisualizationType;
}) {
  if (widget.widgetType === "metric")
    return <Hash className="h-4 w-4 text-muted-foreground shrink-0" />;
  if (widget.widgetType === "text")
    return <Type className="h-4 w-4 text-muted-foreground shrink-0" />;
  if (widget.widgetType === "pivot")
    return <TableProperties className="h-4 w-4 text-muted-foreground shrink-0" />;
  const chartCfg = widget.config as { chartType?: string };
  const type = vizType ?? chartCfg.chartType;
  const Icon = (type && CHART_ICONS[type]) || BarChart3;
  return <Icon className="h-4 w-4 text-muted-foreground shrink-0" />;
}

// ---------------------------------------------------------------------------
// Body — switches by widget type.
// ---------------------------------------------------------------------------

interface BodyProps {
  widget: DashboardWidget;
  dataset: Dataset;
  source: DataSource;
  visualization?: Visualization;
  globalFilters: FilterCondition[];
}

function WidgetBody(props: BodyProps) {
  const { widget } = props;
  if (widget.widgetType === "text") {
    return <TextWidget widget={widget} />;
  }
  if (widget.widgetType === "metric") {
    return <MetricWidget {...props} />;
  }
  return <VisualizationWidget {...props} />;
}

function TextWidget({ widget }: { widget: DashboardWidget }) {
  const cfg = widget.config as Partial<TextWidgetConfig>;
  return (
    <div className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
      {cfg.text || "—"}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Query debounce: every widget debounces globalFilters changes to avoid spamming
// /api/query while the user interacts with the filter bar.
// ---------------------------------------------------------------------------

function useDebouncedQuery<T>(
  runner: () => Promise<T>,
  deps: unknown[],
  delay = 300,
): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRun = useRef(0);

  useEffect(() => {
    const runId = latestRun.current + 1;
    latestRun.current = runId;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await runner();
        if (runId === latestRun.current) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (runId === latestRun.current) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (runId === latestRun.current) setLoading(false);
      }
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}

function MetricWidget({
  widget,
  dataset,
  source,
  globalFilters,
}: BodyProps) {
  const cfg = widget.config as Partial<MetricWidgetConfig> & {
    caption?: MetricCaption;
  };
  const column = cfg.column ?? "";
  const aggregation = cfg.aggregation ?? "SUM";
  // «Авто» (и не задан) — формат поля: вычисляемого (`CPI ₽` → ₽), плана
  // или по суффиксу `_rub`/`_usd`.
  const format = cfg.format ?? "auto";

  // Поле плана? Тогда значение считает сервер по плану (`plan` в запросе),
  // у `· выполнение %` — светофор и подпись с прогнозом.
  // Демо-виджет считает по демо-плану, даже если на демо-датасете есть свой проект.
  // Виджет из шаблона «Собрать дашборд» помнит свой проект (`planProjectId`).
  const { planCtx, displayFields: planDisplayFields } = usePlanForDataset(dataset.id, {
    demoObject: isDemoObjectId(widget.id),
    projectId: cfg.planProjectId,
  });
  const planHit = useMemo(
    () => (planCtx && column ? resolvePlanColumn(column, planCtx.fields) : null),
    [planCtx, column],
  );
  const caption: MetricCaption | null = useMemo(() => {
    if (cfg.caption?.column) return cfg.caption;
    if (planHit?.virtualKind === "completion" && planHit.field.kind === "volume") {
      return {
        column: planColumnName(planHit.field.label, "forecast"),
        aggregation: "SUM",
        label: "прогноз",
        format: planHit.field.format,
      };
    }
    return null;
  }, [cfg.caption, planHit]);

  const body = useMemo(
    () => ({
      dataSourceId: dataset.dataSourceId,
      datasetId: dataset.id,
      table: dataset.table,
      sqlQuery: dataset.sqlQuery,
      source: sourceToBody(source),
      chartType: "pivot" as VisualizationType,
      config: {
        rows: [],
        columns: [],
        values: [
          { column, aggregation },
          ...(caption ? [{ column: caption.column, aggregation: caption.aggregation }] : []),
        ] as PivotValueConfig[],
        filters: globalFilters,
      } satisfies VisualizationConfig,
      calculatedFields: dataset.calculatedFields ?? [],
      plan: planCtx,
    }),
    [dataset, source, column, aggregation, caption, globalFilters, planCtx],
  );

  const { data, loading, error } = useDebouncedQuery<QueryResultRow[]>(
    async () => {
      if (!column) return [];
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await readApiJson<{
        data?: QueryResultRow[];
        error?: string;
      }>(res);
      if (json.error) throw new Error(json.error);
      return json.data ?? [];
    },
    [JSON.stringify(body)],
  );

  const key = valueKey({ column, aggregation });
  const rawValue =
    data && data.length > 0 ? (data[0]?.[key] as number | null | undefined) : null;
  const captionRaw =
    caption && data && data.length > 0
      ? data[0]?.[valueKey({ column: caption.column, aggregation: caption.aggregation })]
      : null;
  const captionValue =
    captionRaw === null || captionRaw === undefined || captionRaw === ""
      ? null
      : Number(captionRaw);

  // Тренд для спарклайна + дельты: та же метрика, сгруппированная по дате
  // (если в датасете есть колонка типа date/datetime). Считается на тех же
  // реальных данных — это «индикатор» как в макете, не статика.
  // У полей плана тренда нет: цвет у них — светофор, а не рост/падение.
  const dateCol = useMemo(
    () =>
      planHit
        ? null
        : (dataset.columns.find(
            (c) =>
              c.enabled && (c.datasetType === "date" || c.datasetType === "datetime"),
          )?.name ?? null),
    [dataset.columns, planHit],
  );

  const trendBody = useMemo(
    () =>
      dateCol
        ? {
            dataSourceId: dataset.dataSourceId,
            datasetId: dataset.id,
            table: dataset.table,
            sqlQuery: dataset.sqlQuery,
            source: sourceToBody(source),
            chartType: "pivot" as VisualizationType,
            config: {
              rows: [dateCol],
              columns: [],
              values: [{ column, aggregation }] as PivotValueConfig[],
              filters: globalFilters,
            } satisfies VisualizationConfig,
            calculatedFields: dataset.calculatedFields ?? [],
          }
        : null,
    [dateCol, dataset, source, column, aggregation, globalFilters],
  );

  const { data: trendData } = useDebouncedQuery<QueryResultRow[]>(
    async () => {
      if (!column || !trendBody) return [];
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trendBody),
      });
      const json = await readApiJson<{ data?: QueryResultRow[]; error?: string }>(res);
      if (json.error) return [];
      return json.data ?? [];
    },
    [JSON.stringify(trendBody)],
  );

  const series = useMemo(() => {
    if (!dateCol || !trendData || trendData.length < 2) return [];
    return [...trendData]
      .sort((a, b) => String(a[dateCol]).localeCompare(String(b[dateCol])))
      .map((r) => Number(r[key]) || 0);
  }, [trendData, dateCol, key]);

  // Дельта: среднее второй половины периода против первой (сглаженно).
  const delta = useMemo(() => {
    if (series.length < 4) return null;
    const mid = Math.floor(series.length / 2);
    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / (arr.length || 1);
    const first = avg(series.slice(0, mid));
    const second = avg(series.slice(mid));
    if (!first) return null;
    return ((second - first) / Math.abs(first)) * 100;
  }, [series]);

  // Цвета — токены темы: нейтральный тренд синим, рост/падение — ok/bad.
  const sparkColor =
    delta === null
      ? "hsl(var(--chart-1))"
      : delta >= 0
        ? "hsl(var(--ok))"
        : "hsl(var(--bad))";

  // Светофор `· выполнение %` (значение в процентах: 88 = 88%).
  const isCompletion = planHit?.virtualKind === "completion";
  const light =
    isCompletion && rawValue !== null && rawValue !== undefined
      ? completionColumnLight(Number(rawValue), planHit.field.direction)
      : null;
  const lightColor = light ? `hsl(var(--${light}))` : undefined;

  const valueText = (v: number): string => {
    if (isCompletion && (format === "auto" || format === "percent")) {
      return formatCompletionPercent(v);
    }
    if (format !== "auto") return formatMetric(v, format);
    const inherited = planHit
      ? planHit.field.format
      : resolveValueFormat(
          { column, aggregation },
          { calculatedFields: dataset.calculatedFields },
        );
    return inherited ? formatCalculatedValue(v, inherited) : formatMetric(v, "number");
  };
  const captionText = (v: number): string => {
    const f = caption?.format;
    if (!f) return formatNumber(v, 0);
    if (f === "currency") return formatCalculatedValue(v, "currency_usd");
    return formatCalculatedValue(v, f);
  };

  return (
    <div className="flex h-full min-h-[100px] flex-col justify-center">
      {loading && !data ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : error ? (
        <div className="text-xs text-destructive">{error}</div>
      ) : rawValue === null || rawValue === undefined ? (
        <div className="text-sm text-muted-foreground">—</div>
      ) : (
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div
                className="font-mono text-3xl font-semibold tracking-tight tabular-nums"
                style={lightColor ? { color: lightColor } : undefined}
              >
                {valueText(Number(rawValue))}
              </div>
              {light && (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
                  style={{ background: `hsl(var(--${light}) / 0.12)`, color: lightColor }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: lightColor }}
                    aria-hidden
                  />
                  {planHit ? trafficLightLabel(light, planHit.field.direction) : null}
                </span>
              )}
              {delta !== null && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                  style={{
                    background:
                      delta >= 0 ? "hsl(var(--ok) / 0.12)" : "hsl(var(--bad) / 0.12)",
                    color: delta >= 0 ? "hsl(var(--ok))" : "hsl(var(--bad))",
                  }}
                >
                  {delta >= 0 ? (
                    <ArrowUp className="h-2.5 w-2.5" strokeWidth={2.6} />
                  ) : (
                    <ArrowDown className="h-2.5 w-2.5" strokeWidth={2.6} />
                  )}
                  {Math.abs(delta).toFixed(1)}%
                </span>
              )}
            </div>
            {caption && captionValue !== null && Number.isFinite(captionValue) ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {caption.label}{" "}
                <span className="font-medium tabular-nums text-foreground/80">
                  {captionText(captionValue)}
                </span>
              </div>
            ) : (
              <div className="mt-1 text-xs text-muted-foreground">
                {planHit
                  ? column
                  : valueLabel(
                      { column, aggregation },
                      {
                        datasetColumns: dataset.columns,
                        calculatedFields: [
                          ...(dataset.calculatedFields ?? []),
                          ...planDisplayFields,
                        ],
                      },
                    )}
              </div>
            )}
          </div>
          {series.length >= 2 && (
            <div className="w-20 shrink-0 self-center">
              <Sparkline data={series} color={sparkColor} height={36} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatMetric(
  v: number,
  format: Exclude<NonNullable<MetricWidgetConfig["format"]>, "auto">,
): string {
  if (Number.isNaN(v)) return "—";
  // `currency` — старое значение формата метрики: доллары.
  if (format === "currency") return formatCalculatedValue(v, "currency_usd");
  if (format === "currency_rub" || format === "currency_usd" || format === "integer") {
    return formatCalculatedValue(v, format);
  }
  if (format === "percent") {
    return `${formatNumber(v, Math.abs(v) < 10 ? 2 : 1)}%`;
  }
  return formatNumber(v, Math.abs(v) < 10 ? 2 : 0);
}

function VisualizationWidget({
  widget,
  dataset,
  source,
  visualization,
  globalFilters,
}: BodyProps) {
  // A widget may either reference a saved Visualization (visualization prop
  // resolved by the parent) or carry an inline config (chart/pivot widgets
  // created via the "Add widget" dialog).
  const inline = widget.config as {
    chartType?: VisualizationType;
    xAxis?: string;
    yAxis?: PivotValueConfig;
    series?: string | null;
    rows?: string[];
    columns?: string[];
    values?: PivotValueConfig[];
  };

  const chartType: VisualizationType = visualization
    ? visualization.type
    : (inline.chartType ?? (widget.widgetType === "pivot" ? "pivot" : "bar"));

  const vizConfig: VisualizationConfig = useMemo(
    () =>
      visualization
        ? visualization.config
        : {
            rows: inline.rows ?? [],
            columns: inline.columns ?? [],
            values: inline.values ?? [],
            xAxis: inline.xAxis,
            yAxis: inline.yAxis,
            series: inline.series ?? null,
            filters: [],
          },
    [visualization, inline],
  );

  const mergedFilters: FilterCondition[] = useMemo(
    () => [...(vizConfig.filters ?? []), ...globalFilters],
    [vizConfig.filters, globalFilters],
  );

  // План-проект датасета: поля плана в графиках/сводных считает сервер.
  // Демо-виджет/демо-график — по демо-плану (их поля заданы демо-проектом).
  const { planCtx, displayFields: planDisplayFields } = usePlanForDataset(dataset.id, {
    demoObject: isDemoObjectId(widget.id) || isDemoObjectId(visualization?.id ?? ""),
    // График из шаблона «Собрать дашборд» помнит свой проект.
    projectId: visualization?.config.planProjectId,
  });
  const vizCalculatedFields = visualization?.calculatedFields;
  // Формат значений (₽/$/%) в сводной и тултипах: вычисляемые поля + поля плана.
  const displayFields = useMemo(
    () => [
      ...(dataset.calculatedFields ?? []),
      ...(vizCalculatedFields ?? []),
      ...planDisplayFields,
    ],
    [dataset.calculatedFields, vizCalculatedFields, planDisplayFields],
  );

  const body = useMemo(
    () => ({
      dataSourceId: dataset.dataSourceId,
      datasetId: dataset.id,
      table: dataset.table,
      sqlQuery: dataset.sqlQuery,
      source: sourceToBody(source),
      chartType,
      config: { ...vizConfig, filters: mergedFilters },
      calculatedFields: dataset.calculatedFields ?? [],
      vizCalculatedFields,
      plan: planCtx,
    }),
    [dataset, source, chartType, vizConfig, mergedFilters, vizCalculatedFields, planCtx],
  );

  const { data, loading, error } = useDebouncedQuery<QueryResultRow[]>(
    async () => {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await readApiJson<{
        data?: QueryResultRow[];
        error?: string;
      }>(res);
      if (json.error) throw new Error(json.error);
      return json.data ?? [];
    },
    [JSON.stringify(body)],
  );

  if (loading && !data) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-[120px] text-xs text-destructive">{error}</div>
    );
  }
  const rows = data ?? [];

  if (chartType === "pivot") {
    return (
      <PivotTable
        data={rows}
        rows={vizConfig.rows ?? []}
        columns={vizConfig.columns ?? []}
        values={vizConfig.values ?? []}
        datasetColumns={dataset.columns}
        calculatedFields={displayFields}
        valueFormats={vizConfig.valueFormats}
      />
    );
  }

  const xAxisType = dataset.columns.find((c) => c.name === vizConfig.xAxis)?.datasetType;

  if (chartType === "combo" || chartType === "progress") {
    return (
      <ChartRenderer
        type={chartType}
        data={rows}
        xAxis={vizConfig.xAxis}
        yAxis={vizConfig.yAxis}
        values={vizConfig.values}
        breakdown={vizConfig.rows?.[0] ?? null}
        xAxisType={xAxisType}
        calculatedFields={displayFields}
        valueFormats={vizConfig.valueFormats}
        planFields={planCtx?.fields}
        datasetColumns={dataset.columns}
      />
    );
  }

  if (!vizConfig.xAxis || !vizConfig.yAxis) {
    return (
      <div className="flex min-h-[160px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-xs text-muted-foreground">
        Не настроены оси X/Y
      </div>
    );
  }

  return (
    <ChartRenderer
      type={chartType as Exclude<VisualizationType, "pivot">}
      data={rows}
      xAxis={vizConfig.xAxis}
      yAxis={vizConfig.yAxis}
      series={vizConfig.series}
      xAxisType={xAxisType}
      calculatedFields={displayFields}
      valueFormats={vizConfig.valueFormats}
      planFields={planCtx?.fields}
      datasetColumns={dataset.columns}
    />
  );
}

function sourceToBody(source: DataSource) {
  return {
    id: source.id,
    host: source.host,
    port: source.port,
    database: source.database,
    user: source.user,
    password: source.password,
    ssl: source.ssl,
    isDemo: source.isDemo,
  };
}
