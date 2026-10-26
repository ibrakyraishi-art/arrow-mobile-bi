"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DimensionList,
  ValueList,
  SingleDimensionSelect,
  SingleMeasureSelect,
} from "@/components/visualization/FieldSelector";
import { FilterBuilder } from "@/components/visualization/FilterBuilder";
import { PivotTable } from "@/components/visualization/PivotTable";
import { ChartRenderer } from "@/components/visualization/ChartRenderer";
import { DEMO_SAVE_HINT_HREF, isDemoObjectId } from "@/lib/demo-data";
import { usePlanForDataset } from "@/components/visualization/usePlanForDataset";
import { readApiJson } from "@/lib/api-json";
import { comboValues } from "@/lib/aggregation";
import { VisualizationExport } from "@/components/visualization/VisualizationExport";
import { CalculatedFieldsEditor } from "@/components/datasets/CalculatedFieldsEditor";
import { useDatasetStore } from "@/stores/datasetStore";
import { useDataSourceStore } from "@/stores/dataSourceStore";
import {
  DemoVisualizationSaveError,
  useVisualizationStore,
} from "@/stores/visualizationStore";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import type {
  CalculatedField,
  CalculatedFieldFormat,
  QueryResultRow,
  Visualization,
  VisualizationConfig,
  VisualizationType,
} from "@/lib/types";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  BarChart3,
  Calculator,
  ChartBarDecreasing,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  Info,
  LineChart,
  PieChart,
  AreaChart,
  TableProperties,
  RefreshCw,
  RotateCw,
  Save,
  Loader2,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface DatasetsDiagnostics {
  url: string;
  status: number | null;
  durationMs: number | null;
  count: number | null;
  step?: string;
  errorMessage?: string;
  details?: string;
}

const TYPE_META: {
  type: VisualizationType;
  label: string;
  icon: typeof BarChart3;
}[] = [
  { type: "pivot", label: "Сводная", icon: TableProperties },
  { type: "bar", label: "Столбцы", icon: BarChart3 },
  { type: "line", label: "Линии", icon: LineChart },
  { type: "area", label: "Области", icon: AreaChart },
  { type: "pie", label: "Круговая", icon: PieChart },
  { type: "combo", label: "Комбо", icon: ChartNoAxesCombined },
  { type: "progress", label: "Прогресс", icon: ChartBarDecreasing },
];

export default function VisualizationBuilderPage() {
  const params = useParams<{ id: string }>();
  const isNew = params.id === "new";
  const router = useRouter();
  const { toast } = useToast();

  const datasets = useDatasetStore((s) => s.datasets);
  const datasetsLoaded = useDatasetStore((s) => s.loaded);
  const datasetsLoading = useDatasetStore((s) => s.loading);
  const datasetsError = useDatasetStore((s) => s.error);
  const getSource = useDataSourceStore((s) => s.getSource);
  const existing = useVisualizationStore((s) =>
    isNew ? undefined : s.getVisualization(params.id),
  );
  const addViz = useVisualizationStore((s) => s.addVisualization);
  const updateViz = useVisualizationStore((s) => s.updateVisualization);

  const [name, setName] = useState(existing?.name ?? "");
  const [datasetId, setDatasetId] = useState(
    existing?.datasetId ?? datasets[0]?.id ?? "",
  );
  const [type, setType] = useState<VisualizationType>(existing?.type ?? "pivot");
  const [config, setConfig] = useState<VisualizationConfig>(
    existing?.config ?? {
      rows: [],
      columns: [],
      values: [],
      filters: [],
      series: null,
    },
  );
  const [vizCalculatedFields, setVizCalculatedFields] = useState<
    CalculatedField[]
  >(existing?.calculatedFields ?? []);

  const [data, setData] = useState<QueryResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const [datasetsDiag, setDatasetsDiag] = useState<DatasetsDiagnostics | null>(
    null,
  );
  const [datasetsDiagOpen, setDatasetsDiagOpen] = useState(false);
  const [datasetsDiagLoading, setDatasetsDiagLoading] = useState(false);

  const fetchDatasetsDiag = useCallback(async () => {
    const url = "/api/datasets";
    setDatasetsDiagLoading(true);
    setDatasetsDiag({
      url,
      status: null,
      durationMs: null,
      count: null,
    });
    const startedAt = performance.now();
    try {
      const r = await fetch(url, { method: "GET" });
      const durationMs = Math.round(performance.now() - startedAt);
      const body = (await r.json()) as {
        datasets?: { id: string }[];
        count?: number;
        error?: string;
        details?: string;
        step?: string;
      };
      if (!r.ok || body.error) {
        setDatasetsDiag({
          url,
          status: r.status,
          durationMs,
          count: null,
          step: body.step,
          errorMessage: body.error ?? `HTTP ${r.status}`,
          details: body.details,
        });
        return;
      }
      setDatasetsDiag({
        url,
        status: r.status,
        durationMs,
        count: body.count ?? body.datasets?.length ?? 0,
      });
    } catch (e) {
      const durationMs = Math.round(performance.now() - startedAt);
      setDatasetsDiag({
        url,
        status: null,
        durationMs,
        count: null,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDatasetsDiagLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDatasetsDiag();
  }, [fetchDatasetsDiag]);

  const dataset = useMemo(
    () => datasets.find((d) => d.id === datasetId),
    [datasets, datasetId],
  );

  // План-проект датасета: группа «План» в выборе полей, `plan` в запросе.
  const { planCtx, virtualFields: planFields, displayFields: planDisplayFields } =
    // Демо-график (id `demo-…`) считает по демо-плану, как на демо-дашборде.
    // График из шаблона «Собрать дашборд» — по своему проекту (`planProjectId`).
    usePlanForDataset(dataset?.id, {
      demoObject: !isNew && isDemoObjectId(params.id),
      projectId: config.planProjectId,
    });
  const planKey = planCtx ? JSON.stringify(planCtx) : "";

  // Формат значения (₽/$/%/число) — в конфиге визуализации, по имени колонки.
  const formatProps = {
    valueFormats: config.valueFormats,
    onFormatChange: (column: string, format: CalculatedFieldFormat | undefined) => {
      const next = { ...(config.valueFormats ?? {}) };
      if (format) next[column] = format;
      else delete next[column];
      setConfig({
        ...config,
        valueFormats: Object.keys(next).length > 0 ? next : undefined,
      });
    },
  };

  // Если стор уже загрузился, а текущий datasetId пустой/не найден — выберем
  // первый доступный (обычно демо или первый реальный из Supabase).
  useEffect(() => {
    if (!datasetsLoaded) return;
    if (!datasetId || !datasets.some((d) => d.id === datasetId)) {
      if (datasets[0]) setDatasetId(datasets[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetsLoaded, datasets.length]);

  // Запрос уходит на каждое изменение настроек; медленный старый ответ не
  // должен затереть свежий (иначе график «пустеет» — старые данные без меры).
  const latestQuery = useRef(0);

  async function runQuery() {
    if (!dataset) return;
    const source = getSource(dataset.dataSourceId);
    if (!source) return;

    const queryId = ++latestQuery.current;
    const isStale = () => queryId !== latestQuery.current;
    setLoading(true);
    try {
      const body = {
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
        chartType: type,
        config,
        calculatedFields: dataset.calculatedFields ?? [],
        vizCalculatedFields,
        plan: planCtx,
      };
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await readApiJson<{
        data?: QueryResultRow[];
        error?: string;
      }>(res);
      if (isStale()) return;
      if (json.error) {
        toast({
          title: "Ошибка запроса",
          description: json.error,
          variant: "destructive",
        });
        setData([]);
      } else {
        setData(json.data ?? []);
      }
    } catch (e) {
      if (isStale()) return;
      toast({
        title: "Ошибка запроса",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      setData([]);
    } finally {
      if (!isStale()) setLoading(false);
    }
  }

  useEffect(() => {
    runQuery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, type, JSON.stringify(config), JSON.stringify(vizCalculatedFields), planKey]);

  async function onSave() {
    if (!name.trim()) {
      toast({ title: "Введите название", variant: "destructive" });
      return;
    }
    if (!datasetId) {
      toast({ title: "Выберите датасет", variant: "destructive" });
      return;
    }
    const payload: Omit<Visualization, "id"> = {
      name: name.trim(),
      datasetId,
      type,
      config,
      calculatedFields: vizCalculatedFields,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    setSaving(true);
    try {
      if (existing) {
        await updateViz(existing.id, payload);
        toast({ title: "Визуализация обновлена", variant: "success" });
      } else {
        await addViz(payload);
        toast({ title: "Визуализация сохранена", variant: "success" });
      }
      router.push("/visualization");
    } catch (e) {
      toast({
        title: "Ошибка сохранения",
        description:
          e instanceof DemoVisualizationSaveError ? (
            <>
              {e.message}{" "}
              <Link href={DEMO_SAVE_HINT_HREF} className="underline underline-offset-2">
                Загрузить CSV
              </Link>
            </>
          ) : e instanceof Error ? (
            e.message
          ) : (
            String(e)
          ),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const columns = dataset?.columns ?? [];
  // Меры, видимые в FieldSelector / PivotTable: dataset-поля + viz-поля.
  // viz-поле перезаписывает dataset-поле с тем же именем (но в UI это
  // обычно лишний кейс, поскольку имена обязаны быть уникальными).
  const calculatedFields = useMemo(() => {
    const map = new Map<string, CalculatedField>();
    for (const f of dataset?.calculatedFields ?? []) map.set(f.name, f);
    for (const f of vizCalculatedFields) map.set(f.name, f);
    return Array.from(map.values());
  }, [dataset?.calculatedFields, vizCalculatedFields]);
  // Для отображения (формат ячеек/тултипов): вычисляемые поля + поля плана.
  const displayFields = useMemo(
    () => [...calculatedFields, ...planDisplayFields],
    [calculatedFields, planDisplayFields],
  );

  return (
    <PageContainer
      icon={<BarChart3 className="h-5 w-5" />}
      title={existing ? "Редактирование" : "Новая визуализация"}
      description="Выберите датасет, тип визуализации и настройте поля."
      actions={
        <>
          <Button asChild variant="ghost">
            <Link href="/visualization">
              <ArrowLeft />
              Назад
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
            onClick={() => {
              const el = document.getElementById("viz-calc-fields");
              if (!el) return;
              el.scrollIntoView({ behavior: "smooth", block: "start" });
              el.classList.add("ring-2", "ring-primary/60");
              setTimeout(() => {
                el.classList.remove("ring-2", "ring-primary/60");
              }, 1800);
            }}
            title="Перейти к локальным вычисляемым полям этой визуализации"
          >
            <Calculator />
            Формулы
          </Button>
          <Button variant="outline" onClick={runQuery} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Обновить
          </Button>
          <Button variant="gradient" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Сохранить
          </Button>
        </>
      }
    >
      <div className="mb-5">
        <Input
          value={name}
          placeholder="Название визуализации"
          onChange={(e) => setName(e.target.value)}
          className="text-base max-w-xl"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
        <Card className="h-fit lg:sticky lg:top-20">
          <CardContent className="space-y-5 p-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Датасет
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {datasetsLoading
                    ? "загрузка…"
                    : `${datasets.length} в списке`}
                </span>
              </div>
              <Select value={datasetId} onValueChange={setDatasetId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Выберите датасет" />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {datasetsError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-medium">
                      Не удалось загрузить датасеты
                    </div>
                    <div className="font-mono break-all opacity-80">
                      {datasetsError}
                    </div>
                  </div>
                </div>
              )}

              {/* Диагностика — только когда список датасетов не загрузился. */}
              {datasetsDiag?.errorMessage && (
              <div className="rounded-md border border-border bg-muted/10">
                <button
                  type="button"
                  onClick={() => setDatasetsDiagOpen((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  {datasetsDiagOpen ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  <Info className="h-3 w-3" />
                  <span>Диагностика загрузки датасетов</span>
                  {datasetsDiag?.status !== null &&
                    datasetsDiag?.status !== undefined && (
                      <span
                        className={`ml-auto font-mono ${
                          datasetsDiag.errorMessage
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {datasetsDiag.status} ·{" "}
                        {datasetsDiag.durationMs ?? 0} мс
                      </span>
                    )}
                </button>
                {datasetsDiagOpen && (
                  <div className="space-y-1 border-t border-border px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    <div className="break-all">
                      <span className="text-foreground/70">request:</span> GET{" "}
                      {datasetsDiag?.url ?? "/api/datasets"}
                    </div>
                    <div>
                      <span className="text-foreground/70">status:</span>{" "}
                      {datasetsDiag?.status ?? (datasetsDiagLoading ? "…" : "—")}
                    </div>
                    <div>
                      <span className="text-foreground/70">duration:</span>{" "}
                      {datasetsDiag?.durationMs !== null &&
                      datasetsDiag?.durationMs !== undefined
                        ? `${datasetsDiag.durationMs} ms`
                        : datasetsDiagLoading
                          ? "…"
                          : "—"}
                    </div>
                    <div>
                      <span className="text-foreground/70">count (server):</span>{" "}
                      {datasetsDiag?.count ?? (datasetsDiagLoading ? "…" : "—")}
                    </div>
                    <div>
                      <span className="text-foreground/70">count (store):</span>{" "}
                      {datasets.length}{" "}
                      <span className="text-foreground/40">
                        (включая демо)
                      </span>
                    </div>
                    <div>
                      <span className="text-foreground/70">store.loaded:</span>{" "}
                      {String(datasetsLoaded)}
                    </div>
                    {datasetsDiag?.step && (
                      <div>
                        <span className="text-foreground/70">step:</span>{" "}
                        <span className="text-destructive">
                          {datasetsDiag.step}
                        </span>
                      </div>
                    )}
                    {datasetsDiag?.errorMessage && (
                      <div className="break-all">
                        <span className="text-foreground/70">error:</span>{" "}
                        <span className="text-destructive/80">
                          {datasetsDiag.errorMessage}
                        </span>
                      </div>
                    )}
                    {datasetsDiag?.details && (
                      <div className="break-all">
                        <span className="text-foreground/70">details:</span>{" "}
                        <span className="text-destructive/80">
                          {datasetsDiag.details}
                        </span>
                      </div>
                    )}
                    <div className="pt-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={fetchDatasetsDiag}
                        disabled={datasetsDiagLoading}
                      >
                        <RotateCw
                          className={cn(
                            "h-3 w-3 mr-1",
                            datasetsDiagLoading && "animate-spin",
                          )}
                        />
                        Повторить запрос
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Тип визуализации
              </div>
              <div className="grid grid-cols-4 gap-1">
                {TYPE_META.map(({ type: t, icon: Icon, label }) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    title={label}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border px-1.5 py-2 transition-all",
                      type === t
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-card/40 text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-[9px] font-medium uppercase tracking-wider">
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Вычисляемые поля — перенесены сюда (раньше были в самом
                низу под Фильтрами). Так пользователь сразу видит, что
                может создать формулу, прежде чем конфигурировать поля. */}
            <div
              id="viz-calc-fields"
              className="space-y-3 rounded-lg border border-primary/40 bg-gradient-to-br from-primary/5 via-card to-card p-3 shadow-[0_0_0_1px_theme(colors.primary.DEFAULT/0.15)] transition-shadow"
            >
              <div className="flex items-start gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary ring-1 ring-primary/30">
                  <Calculator className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                      Вычисляемые поля
                    </span>
                    <span className="rounded-md bg-primary/15 px-1 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-primary">
                      fx
                    </span>
                    {vizCalculatedFields.length > 0 && (
                      <span className="rounded-md border border-border bg-secondary/50 px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                        {vizCalculatedFields.length}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                    Создайте метрику только для этой визуализации. Например{" "}
                    <code className="font-mono text-foreground">
                      SUM([revenue_rub]) / SUM([installs])
                    </code>{" "}
                    = ARPU (для долей делите СУММУ на СУММУ, не строку на строку).
                    Появится в списках «Значения» / «Ось Y» ниже.
                  </p>
                </div>
              </div>
              <CalculatedFieldsEditor
                fields={vizCalculatedFields}
                columns={[
                  ...columns,
                  // Экспонируем dataset-поля как ссылочные источники для
                  // viz-полей: «integer» датасет-тип хватает, чтобы парсер
                  // принял имя как валидное.
                  ...(dataset?.calculatedFields ?? []).map((cf) => ({
                    name: cf.name,
                    clickhouseType: "Float64",
                    datasetType: "float" as const,
                    description: cf.description ?? "",
                    businessContext: "",
                    enabled: true,
                  })),
                ]}
                onChange={setVizCalculatedFields}
                variant="visualization"
              />
            </div>

            {type === "pivot" ? (
              <>
                <DimensionList
                  label="Строки"
                  columns={columns}
                  selected={config.rows}
                  onChange={(rows) => setConfig({ ...config, rows })}
                />
                <DimensionList
                  label="Столбцы"
                  columns={columns}
                  selected={config.columns}
                  onChange={(cols) =>
                    setConfig({ ...config, columns: cols })
                  }
                />
                <ValueList
                  label="Значения"
                  columns={columns}
                  calculatedFields={calculatedFields}
                  planFields={planFields}
                  {...formatProps}
                  selected={config.values}
                  onChange={(values) => setConfig({ ...config, values })}
                />
              </>
            ) : type === "combo" ? (
              <>
                <SingleDimensionSelect
                  label="Ось X"
                  columns={columns}
                  value={config.xAxis ?? null}
                  onChange={(v) =>
                    setConfig({ ...config, xAxis: v ?? undefined })
                  }
                />
                <ValueList
                  label="Значения: 1-е — столбцы, далее — линии"
                  columns={columns}
                  calculatedFields={calculatedFields}
                  planFields={planFields}
                  {...formatProps}
                  selected={comboValues(config)}
                  onChange={(values) =>
                    setConfig({ ...config, values, yAxis: values[0] })
                  }
                />
              </>
            ) : type === "progress" ? (
              <>
                <SingleDimensionSelect
                  label="Разрез (необязательно)"
                  columns={columns}
                  value={config.rows[0] ?? null}
                  onChange={(v) => setConfig({ ...config, rows: v ? [v] : [] })}
                  allowClear
                />
                <ValueList
                  label="Поля выполнения"
                  columns={columns}
                  calculatedFields={calculatedFields}
                  planFields={planFields.filter((f) => f.virtualKind === "completion")}
                  selected={config.values}
                  onChange={(values) => setConfig({ ...config, values })}
                />
                {planFields.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    У этого датасета нет план-проекта. Создайте его в разделе
                    «План» — тогда здесь появятся поля «· выполнение %».
                  </p>
                )}
              </>
            ) : (
              <>
                <SingleDimensionSelect
                  label="Ось X"
                  columns={columns}
                  value={config.xAxis ?? null}
                  onChange={(v) =>
                    setConfig({ ...config, xAxis: v ?? undefined })
                  }
                />
                <SingleMeasureSelect
                  label="Ось Y"
                  columns={columns}
                  calculatedFields={calculatedFields}
                  planFields={planFields}
                  {...formatProps}
                  value={config.yAxis}
                  onChange={(v) => setConfig({ ...config, yAxis: v })}
                />
                {type !== "pie" && (
                  <SingleDimensionSelect
                    label="Серии (группировка)"
                    columns={columns}
                    value={config.series ?? null}
                    onChange={(v) => setConfig({ ...config, series: v })}
                    allowClear
                  />
                )}
              </>
            )}

            <FilterBuilder
              columns={columns}
              filters={config.filters}
              onChange={(filters) => setConfig({ ...config, filters })}
            />
          </CardContent>
        </Card>

        <Card className="min-h-[520px]">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Результат
              </div>
              <VisualizationExport
                name={name || "visualization"}
                type={type}
                data={data}
                chartRef={exportRef}
              />
            </div>
            <ResultMetricStrip
              type={type}
              rows={data.length}
              loading={loading}
              config={config}
            />
            {!loading && data.length > 0 && type === "pivot" && (
              <div className="mb-3 flex items-start gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground">
                <ArrowUpDown className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                <p>
                  <span className="font-medium text-foreground">
                    Кликните по заголовку колонки
                  </span>{" "}
                  — данные отсортируются (по возрастанию / убыванию / отмена).
                  Работает для дат, чисел и текста. Для фильтрации диапазонов
                  (например{" "}
                  <code className="font-mono text-foreground">
                    revenue ≥ 1000
                  </code>
                  ) — используйте раздел{" "}
                  <span className="font-medium text-foreground">«Фильтры»</span>{" "}
                  слева.
                </p>
              </div>
            )}
            <div ref={exportRef} className="bg-card">
              {loading ? (
                <ResultSkeleton type={type} />
              ) : type === "pivot" ? (
                <PivotTable
                  data={data}
                  rows={config.rows}
                  columns={config.columns}
                  values={config.values}
                  datasetColumns={dataset?.columns}
                  calculatedFields={displayFields}
                  valueFormats={config.valueFormats}
                />
              ) : type === "combo" || type === "progress" ? (
                <ChartRenderer
                  type={type}
                  data={data}
                  xAxis={config.xAxis}
                  yAxis={config.yAxis}
                  values={config.values}
                  breakdown={config.rows[0] ?? null}
                  xAxisType={
                    dataset?.columns.find((c) => c.name === config.xAxis)
                      ?.datasetType
                  }
                  calculatedFields={displayFields}
                  valueFormats={config.valueFormats}
                  planFields={planCtx?.fields}
                  datasetColumns={dataset?.columns}
                />
              ) : config.xAxis && config.yAxis ? (
                <ChartRenderer
                  type={type as Exclude<VisualizationType, "pivot">}
                  data={data}
                  xAxis={config.xAxis}
                  yAxis={config.yAxis}
                  series={config.series}
                  calculatedFields={displayFields}
                  valueFormats={config.valueFormats}
                  planFields={planCtx?.fields}
                  datasetColumns={dataset?.columns}
                  xAxisType={
                    dataset?.columns.find((c) => c.name === config.xAxis)
                      ?.datasetType
                  }
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/10 py-20 text-center">
                  <BarChart3
                    className="h-9 w-9 text-muted-foreground/40"
                    aria-hidden
                  />
                  <div className="text-base font-medium text-foreground">
                    Здесь будет график
                  </div>
                  <div className="max-w-xs text-xs text-muted-foreground">
                    Настройте оси X и Y, чтобы построить график
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}

/**
 * Полоска из 2-3 чипов над таблицей/графиком: количество строк,
 * количество видимых колонок, краткая сводка конфигурации
 * (`SUM(spend) by date · series=country` для графиков; для pivot —
 * количество мер и измерений).
 */
function ResultMetricStrip({
  type,
  rows,
  loading,
  config,
}: {
  type: VisualizationType;
  rows: number;
  loading: boolean;
  config: VisualizationConfig;
}) {
  if (loading || rows === 0) return null;

  const isPivot = type === "pivot";
  const isMulti = type === "combo" || type === "progress";
  const colsCount = isPivot
    ? config.rows.length + config.columns.length + config.values.length
    : isMulti
      ? (type === "combo" ? (config.xAxis ? 1 : 0) : config.rows.length) +
        config.values.length
      : 1 + (config.series ? 1 : 0) + (config.yAxis ? 1 : 0);

  let summary = "";
  if (isMulti) {
    const vals = config.values.map((v) => v.column).join(", ") || "—";
    const dim = type === "combo" ? config.xAxis : config.rows[0];
    summary = dim ? `${vals} by ${dim}` : vals;
  } else if (isPivot) {
    const dimCount = config.rows.length + config.columns.length;
    summary = `${config.values.length} мер${plural(config.values.length, "а", "ы", "")} · ${dimCount} измерен${plural(dimCount, "ие", "ия", "ий")}`;
  } else {
    const y = config.yAxis;
    const yLabel = y ? `${y.aggregation}(${y.column})` : "—";
    const xLabel = config.xAxis ?? "—";
    const seriesLabel = config.series ? ` · series=${config.series}` : "";
    summary = `${yLabel} by ${xLabel}${seriesLabel}`;
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Chip>📊 Строк: {rows.toLocaleString("ru-RU")}</Chip>
      <Chip>📐 Колонок: {colsCount}</Chip>
      <Chip mono>⚙️ {summary}</Chip>
    </div>
  );
}

function Chip({
  children,
  mono,
}: {
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-[11px] text-foreground/80",
        mono && "font-mono",
      )}
    >
      {children}
    </span>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Скелетон, имитирующий силуэт таблицы или графика — заметнее, чем
 * один большой Skeleton.
 */
function ResultSkeleton({ type }: { type: VisualizationType }) {
  if (type === "pivot") {
    return (
      <div className="space-y-1.5 rounded-lg border border-border p-3">
        <Skeleton className="h-7 w-full" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full opacity-60" />
        ))}
      </div>
    );
  }
  // bar/line/area/pie — серия вертикальных скелетон-баров
  const heights = [60, 90, 70, 130, 85, 110, 75, 150, 100, 120, 95, 65];
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex h-[360px] items-end justify-between gap-2">
        {heights.map((h, i) => (
          <Skeleton
            key={i}
            className="w-full rounded-t-md"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <div className="mt-3 flex justify-between">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-12" />
        ))}
      </div>
    </div>
  );
}
