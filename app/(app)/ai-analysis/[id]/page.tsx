"use client";

import { exportBackgroundColor } from "@/lib/theme";
import { BRAND_FILE_PREFIX } from "@/lib/brand";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Check,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  Lock,
  Pencil,
  Save,
  Send,
  Shield,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingState } from "@/components/layout/LoadingState";
import { useToast } from "@/components/ui/use-toast";
import { useAiProjectStore } from "@/stores/aiProjectStore";
import { useDatasetStore } from "@/stores/datasetStore";
import { useDataSourceStore } from "@/stores/dataSourceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { ModelSelector } from "@/components/ai/ModelSelector";
import { AnalysisResult } from "@/components/ai/AnalysisResult";
import { ExportPanel } from "@/components/ai/ExportPanel";
import { ChartRenderer } from "@/components/visualization/ChartRenderer";
import { LlmOnboarding } from "@/components/ai/LlmOnboarding";
import { ProjectFilters } from "@/components/ai/ProjectFilters";
import { AiGroupingZone } from "@/components/ai/AiGroupingZone";
import { AiMetricsZone } from "@/components/ai/AiMetricsZone";
import { AiCalcFieldsZone } from "@/components/ai/AiCalcFieldsZone";
import { AiContextPanel } from "@/components/ai/AiContextPanel";
import type { AnonymizePreview } from "@/components/ai/ConfidentialityPanel";
import { estimateTokens } from "@/components/ai/CostEstimate";
import {
  DEFAULT_MODEL,
  estimateModelCost,
  firstConfiguredModelId,
  isProviderEnabled,
  PROVIDER_LIST,
  PROVIDERS,
  resolveModel,
  type AIProvider,
} from "@/lib/ai-models";
import { valueKey } from "@/lib/aggregation";
import { detectPiiColumns } from "@/lib/pii";
import { buildGlobalFilterConditions } from "@/lib/dashboard-filters";
import {
  computeAggregateFlags,
  prepareCalculatedFields,
  validateFormula,
} from "@/lib/formula";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type {
  AggregationType,
  AIModelId,
  AIProject,
  AIProjectRun,
  FilterCondition,
  PivotValueConfig,
  QueryResultRow,
  VisualizationType,
} from "@/lib/types";

const SUGGESTIONS = [
  "Найди самые убыточные сегменты и почему",
  "Где теряется бюджет на воронке конверсий?",
  "Сравни каналы по ROI и дай рекомендации с цифрами",
];

function rowsToCsv(rows: QueryResultRow[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n;\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = keys.join(",");
  const body = rows.map((r) => keys.map((k) => esc(r[k])).join(",")).join("\n");
  return `${header}\n${body}`;
}

/** Валидный SQL-идентификатор (как validateColumnName на сервере). */
const FIELD_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Эвристика дублей строк (JOIN-фанаут в источнике): одинаковые строки
 * повторяются ≥3 раза и всего строк существенно больше, чем уникальных. Тогда
 * SUM в сводной таблице завышается ~в `factor` раз.
 */
function detectRowDuplication(
  rows: QueryResultRow[],
): { factor: number; total: number; distinct: number } | null {
  if (rows.length < 6) return null;
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = JSON.stringify(r);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const distinct = counts.size;
  const total = rows.length;
  let maxRepeat = 0;
  for (const c of counts.values()) if (c > maxRepeat) maxRepeat = c;
  if (distinct > 0 && total / distinct >= 2 && maxRepeat >= 3) {
    return { factor: Math.round(total / distinct), total, distinct };
  }
  return null;
}

export default function AIProjectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const projectId = params.id;

  const currentProject = useAiProjectStore((s) => s.currentProject);
  const runs = useAiProjectStore((s) => s.runs);
  const loadProject = useAiProjectStore((s) => s.loadProject);
  const updateProject = useAiProjectStore((s) => s.updateProject);
  const createRun = useAiProjectStore((s) => s.createRun);
  const deleteRun = useAiProjectStore((s) => s.deleteRun);

  const getDataset = useDatasetStore((s) => s.getDataset);
  const getSource = useDataSourceStore((s) => s.getSource);
  const settings = useSettingsStore((s) => s.settings);
  const settingsLoaded = useSettingsStore((s) => s.loaded);

  const [loading, setLoading] = useState(true);
  const [nameDraft, setNameDraft] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);

  const [promptDraft, setPromptDraft] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [confidentialDraft, setConfidentialDraft] = useState<string[]>([]);
  // Группировка для AI: измерения + метрики. Если задано — в Claude уходит
  // сводная таблица (агрегация по всему датасету), а не сырые строки.
  const [analysisGroupBy, setAnalysisGroupBy] = useState<string[]>([]);
  const [analysisMetrics, setAnalysisMetrics] = useState<PivotValueConfig[]>([]);
  const [includeFunnel, setIncludeFunnel] = useState(false);
  // Оптимистичный выбор модели: триггер меняется МГНОВЕННО, сохранение в БД —
  // в фоне; при ошибке откат. Иначе controlled-Select ждёт async-апдейта
  // Supabase и выглядит как «модель не применяется».
  const [modelDraft, setModelDraft] = useState<AIModelId | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [resultMd, setResultMd] = useState("");
  const [resultMeta, setResultMeta] = useState<{
    cost?: number;
    model?: AIModelId;
    input?: number;
    output?: number;
  } | null>(null);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  // PRISM workspace: панель контекста + промпт «в полёте» (оптимистичный пузырь).
  const [cfgOpen, setCfgOpen] = useState(true);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  // Сколько строк ушло в AI в последнем срезе — для предупреждения при >500.
  const [sentRowCount, setSentRowCount] = useState<number | null>(null);
  // Последний срез данных — для выгрузки в Excel вместе с аналитикой.
  const [lastRows, setLastRows] = useState<QueryResultRow[]>([]);
  // График по последнему срезу (Этап 2 фичи «AI → файлы»).
  const [showChart, setShowChart] = useState(false);
  const [chartType, setChartType] =
    useState<Exclude<VisualizationType, "pivot">>("bar");
  const chartRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Данные для графика из последнего среза: X = первое измерение группировки,
  // Y = первая числовая метрика. Ключ Y строим контролируемо (через valueKey),
  // чтобы ChartRenderer гарантированно нашёл его в данных.
  const chartSpec = useMemo(() => {
    if (lastRows.length === 0) return null;
    const first = lastRows[0];
    const allKeys = Object.keys(first);
    const dims = new Set(analysisGroupBy);
    // Ось X: первое измерение группировки; если группировки нет — первый
    // нечисловой столбец (например, дата), иначе просто первый столбец.
    const xKey =
      analysisGroupBy[0] ??
      allKeys.find((k) => typeof first[k] !== "number") ??
      allKeys[0];
    if (!xKey) return null;
    // Ось Y: первая числовая метрика (не X и не измерение).
    const metricKey = allKeys.find(
      (k) => k !== xKey && !dims.has(k) && typeof first[k] === "number",
    );
    if (!metricKey) return null;
    const label = metricKey.replace(/^[A-Za-z_]+\((.+)\)$/, "$1");
    const yAxis: PivotValueConfig = { column: label, aggregation: "SUM" };
    const yKey = valueKey(yAxis);
    const data: QueryResultRow[] = lastRows.map((r) => ({
      [xKey]: String(r[xKey] ?? "—"),
      [yKey]: Number(r[metricKey]) || 0,
    }));
    return { xKey, yAxis, data };
  }, [lastRows, analysisGroupBy]);

  // Поля последнего среза, похожие на ПЕРСОНАЛЬНЫЕ ДАННЫЕ и НЕ замаскированные
  // (маскировка возможна только для измерений группировки, помеченных 🔒).
  // Питает предупреждение перед отправкой в AI.
  const unmaskedPii = useMemo(() => {
    const masked = new Set(
      analysisGroupBy.filter((c) => confidentialDraft.includes(c)),
    );
    return detectPiiColumns(lastRows).filter((c) => !masked.has(c));
  }, [lastRows, analysisGroupBy, confidentialDraft]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadProject(projectId).then((p) => {
      if (cancelled) return;
      if (!p) {
        toast({
          title: "Проект не найден",
          variant: "destructive",
        });
        router.replace("/ai-analysis");
        return;
      }
      setNameDraft(p.name);
      setPromptDraft(p.prompt ?? "");
      setConfidentialDraft(p.confidentialColumns ?? []);
      setIncludeFunnel(p.includeFunnel ?? false);
      setAnalysisGroupBy(p.builderConfig?.analysisGroupBy ?? []);
      setAnalysisMetrics(p.builderConfig?.analysisMetrics ?? []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Автопрокрутка ленты чата вниз при новых сообщениях/стриминге.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [runs, analyzing, resultMd, pendingPrompt]);

  const project = currentProject && currentProject.id === projectId ? currentProject : null;
  const dataset = project ? getDataset(project.datasetId) : undefined;
  const source = dataset ? getSource(dataset.dataSourceId) : undefined;

  // Активная модель = оптимистичный черновик (если выбран) либо модель проекта.
  const currentModelId: AIModelId = modelDraft ?? project?.model ?? DEFAULT_MODEL;
  const modelInfo = resolveModel(currentModelId);

  // Маркер «ключ настроен» для провайдера выбранной модели (BYOK).
  function providerKeyMarker(p: AIProvider): string {
    return settings.providerKeys[p] ?? "";
  }
  const anyProviderConfigured = PROVIDER_LIST.some(
    (p) => isProviderEnabled(p) && !!providerKeyMarker(p),
  );

  // Анализ должен «просто работать» на ПОДКЛЮЧЁННОЙ пользователем LLM, а не
  // требовать именно Claude. Если у провайдера модели проекта нет ключа, но
  // подключён другой провайдер — один раз переключаем модель на первую доступную
  // (в порядке MODEL_ORDER) и сохраняем выбор. Явный выбор пользователя после
  // этого уважается (повторно не переключаем в этом маунте).
  const autoModelSwitched = useRef(false);
  useEffect(() => {
    if (autoModelSwitched.current) return;
    if (!project || !settingsLoaded) return;
    autoModelSwitched.current = true;
    const prov = resolveModel(project.model).provider;
    // Модель валидна, только если её провайдер ДОСТУПЕН (не «скоро») и с ключом.
    if (isProviderEnabled(prov) && providerKeyMarker(prov)) return;
    const fallback = firstConfiguredModelId(
      (p) => isProviderEnabled(p) && !!providerKeyMarker(p),
    );
    if (fallback && fallback !== project.model) {
      void updateProject(project.id, { model: fallback });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, settingsLoaded]);

  // Снимаем оптимистичный черновик, когда сохранённая модель догнала его
  // (или поменялась извне) — дальше источник истины снова project.model.
  useEffect(() => {
    if (modelDraft && project?.model === modelDraft) setModelDraft(null);
  }, [project?.model, modelDraft]);

  // Промпт — это текст из чата (Конструктор убран; группировку/фокус
  // пользователь выражает прямо в вопросе).
  const activePrompt = promptDraft;
  const promptTokens = useMemo(
    () => estimateTokens(activePrompt || ""),
    [activePrompt],
  );
  const estimatedCost = useMemo(
    () => (project ? estimateModelCost(currentModelId, promptTokens + 2000, 2000) : 0),
    [project, currentModelId, promptTokens],
  );

  async function handleSaveName() {
    if (!project) return;
    const n = nameDraft.trim();
    if (!n || n === project.name) {
      setEditingName(false);
      setNameDraft(project.name);
      return;
    }
    setSavingName(true);
    try {
      await updateProject(project.id, { name: n });
      setEditingName(false);
      toast({ title: "Сохранено", variant: "success" });
    } catch (e) {
      toast({
        title: "Не удалось сохранить",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSavingName(false);
    }
  }

  async function handleModelChange(m: AIModelId) {
    if (!project || currentModelId === m) return;
    setModelDraft(m); // мгновенно показываем выбор в UI (триггер не ждёт сети)
    try {
      await updateProject(project.id, { model: m });
      // черновик снимется эффектом, когда project.model догонит значение
    } catch (e) {
      setModelDraft(null); // откат к сохранённой модели
      toast({
        title: "Не удалось сменить модель",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function handleFiltersConfigChange(cfg: AIProject["filtersConfig"]) {
    if (!project) return;
    const allowedIds = new Set(cfg.map((f) => f.id));
    const nextValues: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(project.filterValues ?? {})) {
      if (allowedIds.has(k)) nextValues[k] = v;
    }
    try {
      await updateProject(project.id, {
        filtersConfig: cfg,
        filterValues: nextValues,
      });
    } catch (e) {
      toast({
        title: "Не удалось сохранить фильтры",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function handleFilterValueChange(filterId: string, value: unknown) {
    if (!project) return;
    const nextValues = { ...(project.filterValues ?? {}), [filterId]: value };
    try {
      await updateProject(project.id, { filterValues: nextValues });
    } catch (e) {
      toast({
        title: "Не удалось сохранить значение фильтра",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function handleResetFilterValues() {
    if (!project) return;
    try {
      await updateProject(project.id, { filterValues: {} });
    } catch (e) {
      toast({
        title: "Не удалось сбросить фильтры",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function handleSavePrompt() {
    if (!project) return;
    setSavingPrompt(true);
    try {
      await updateProject(project.id, { prompt: promptDraft });
      toast({ title: "Промпт сохранён", variant: "success" });
    } catch (e) {
      toast({
        title: "Не удалось сохранить",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSavingPrompt(false);
    }
  }

  // Сохраняем конфиг сводной таблицы (группировка + метрики) в проект.
  // Локально — сразу, в БД — фоном. ВСЕ мутации проходят через ОДИН вызов с
  // полным следующим состоянием — иначе два setState в одном обработчике с
  // устаревшими замыканиями затирали друг друга (из-за чего поля «не удалялись»).
  function persistConfig(groupBy: string[], metrics: PivotValueConfig[]) {
    setAnalysisGroupBy(groupBy);
    setAnalysisMetrics(metrics);
    if (project) {
      void updateProject(project.id, {
        builderConfig: {
          ...(project.builderConfig ?? { columns: [], focus: [] }),
          analysisGroupBy: groupBy,
          analysisMetrics: metrics,
        },
      });
    }
  }

  // --- Атомарные обработчики зон конструктора (каждый — один persistConfig) ---
  // Добавить измерение: дедуп + убрать из метрик (поле — либо строка, либо метрика).
  function addDimension(col: string) {
    if (!col || analysisGroupBy.includes(col)) return;
    persistConfig(
      [...analysisGroupBy, col],
      analysisMetrics.filter((m) => m.column !== col),
    );
  }
  // Убрать измерение — атомарно + снять с него маску (чистое удаление поля).
  function removeDimension(col: string) {
    persistConfig(
      analysisGroupBy.filter((c) => c !== col),
      analysisMetrics,
    );
    if (confidentialDraft.includes(col)) {
      void handleConfidentialChange(confidentialDraft.filter((c) => c !== col));
    }
  }
  function reorderDimensions(next: string[]) {
    persistConfig(next, analysisMetrics);
  }
  function setMetricsConfig(next: PivotValueConfig[]) {
    persistConfig(analysisGroupBy, next);
  }

  // Имена вычисляемых полей с валидной формулой И валидным именем-идентификатором.
  // Метрика, ссылающаяся на невалидное calc-поле или удалённую колонку, роняла
  // бы запрос («Недопустимое имя столбца» / «unknown column») — отсекаем заранее.
  function validCalcFieldNames(): Set<string> {
    if (!dataset) return new Set();
    const calc = dataset.calculatedFields ?? [];
    const allNames = [
      ...dataset.columns.map((c) => c.name),
      ...calc.map((c) => c.name),
    ];
    const flags = computeAggregateFlags(prepareCalculatedFields(calc));
    const isAgg = (n: string) => flags.get(n) === true;
    const valid = new Set<string>();
    for (const cf of calc) {
      if (!FIELD_NAME_RE.test(cf.name)) continue;
      const others = allNames.filter((n) => n !== cf.name);
      if (validateFormula(cf.formula, [...others, cf.name], isAgg).ok)
        valid.add(cf.name);
    }
    return valid;
  }

  // Оставляет только метрики, безопасные для SQL: сырой столбец или валидное
  // вычисляемое поле. Битые (формула/имя/удалённая колонка) — отбрасываем.
  function safeMetrics(metrics: PivotValueConfig[]): PivotValueConfig[] {
    if (!dataset) return metrics;
    const rawCols = new Set(dataset.columns.map((c) => c.name));
    const okCalc = validCalcFieldNames();
    return metrics.filter((m) => rawCols.has(m.column) || okCalc.has(m.column));
  }

  // Сырые строки (без группировки) — для диагностики дублей в источнике.
  async function fetchRawRows(
    filterConditions: FilterCondition[],
    limit = 300,
  ): Promise<QueryResultRow[]> {
    if (!dataset || !source) return [];
    const res = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
        chartType: "pivot",
        config: { rows: [], columns: [], values: [], filters: filterConditions },
        calculatedFields: dataset.calculatedFields ?? [],
        limit,
      }),
    });
    const j = (await res.json()) as { data?: QueryResultRow[] };
    return j.data ?? [];
  }

  // Тянет строки данных из источника с применением фильтров проекта.
  // Используется и анализом, и предпросмотром маскировки. Если задана
  // группировка — в Claude уходит сводная таблица (агрегация по всему
  // датасету), иначе — сырые строки (до 500).
  async function fetchProjectRows(
    filterConditions: FilterCondition[],
  ): Promise<QueryResultRow[]> {
    if (!dataset || !source) return [];
    const grouped = analysisGroupBy.length > 0;
    // Метрики: явные, либо (по умолчанию) все числовые поля, КРОМЕ тех, что уже
    // ушли в группировку (поле — либо измерение-строка, либо метрика).
    const metrics: PivotValueConfig[] = safeMetrics(
      analysisMetrics.length > 0
        ? analysisMetrics.filter((m) => !analysisGroupBy.includes(m.column))
        : grouped
          ? dataset.columns
              .filter(
                (c) =>
                  c.enabled &&
                  !analysisGroupBy.includes(c.name) &&
                  (c.datasetType === "integer" || c.datasetType === "float"),
              )
              .map((c) => ({
                column: c.name,
                aggregation: "SUM" as AggregationType,
              }))
          : [],
    );
    const queryRes = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
        chartType: "pivot",
        config: {
          rows: grouped ? analysisGroupBy : [],
          columns: [],
          values: grouped ? metrics : [],
          filters: filterConditions,
        },
        calculatedFields: dataset.calculatedFields ?? [],
        limit: 5000,
      }),
    });
    const qj = (await queryRes.json()) as {
      data?: QueryResultRow[];
      error?: string;
    };
    if (qj.error) throw new Error(qj.error);
    // В данные для AI/предпросмотра вычисляемые поля выводим под ИМЕНЕМ поля, без
    // обёртки агрегации (SUM(CTR) → CTR): у calc-полей внешней агрегации нет.
    // Обычные столбцы оставляем как есть (SUM(spend) и т.п.).
    const calcNames = new Set((dataset.calculatedFields ?? []).map((f) => f.name));
    const renameKey = new Map<string, string>();
    if (grouped) {
      for (const m of metrics) {
        if (calcNames.has(m.column)) renameKey.set(valueKey(m), m.column);
      }
    }
    const rows =
      renameKey.size === 0
        ? (qj.data ?? [])
        : (qj.data ?? []).map((r) => {
            const o: QueryResultRow = {};
            for (const [k, v] of Object.entries(r)) o[renameKey.get(k) ?? k] = v;
            return o;
          });
    // Раньше был жёсткий лимит 500 строк. Теперь — только высокий
    // предохранитель объёма (5000); при >500 строк пользователь видит
    // предупреждение, что AI может ошибаться (ограничения модели) и стоимость
    // выше. setSentRowCount питает это предупреждение в UI.
    const limited = rows.slice(0, 5000);
    setSentRowCount(limited.length);
    setLastRows(limited);
    return limited;
  }

  // Снимок графика в PNG — для скачивания и вставки в Excel.
  async function captureChartPng(): Promise<string | null> {
    if (!showChart || !chartSpec || !chartRef.current) return null;
    try {
      const { toPng } = await import("html-to-image");
      return await toPng(chartRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: exportBackgroundColor(chartRef.current),
      });
    } catch {
      return null;
    }
  }

  async function onDownloadChartPng() {
    const png = await captureChartPng();
    if (!png) {
      toast({ title: "График не готов", variant: "destructive" });
      return;
    }
    const a = document.createElement("a");
    a.href = png;
    a.download = `${BRAND_FILE_PREFIX}-chart-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleConfidentialChange(cols: string[]) {
    if (!project) return;
    setConfidentialDraft(cols);
    try {
      await updateProject(project.id, { confidentialColumns: cols });
    } catch (e) {
      toast({
        title: "Не удалось сохранить настройку конфиденциальности",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function handleIncludeFunnelChange(v: boolean) {
    if (!project) return;
    setIncludeFunnel(v);
    try {
      await updateProject(project.id, { includeFunnel: v });
    } catch (e) {
      toast({
        title: "Не удалось сохранить настройку воронки",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  // Маскировка задаётся ТОЛЬКО на полях группировки (👁 открыто / 🔒 маска).
  // 🔒 → поле в confidentialColumns (токенизация на сервере); 👁 → убираем.
  function toggleMask(name: string, mask: boolean) {
    const next = mask
      ? Array.from(new Set([...confidentialDraft, name]))
      : confidentialDraft.filter((c) => c !== name);
    void handleConfidentialChange(next);
  }

  // Реально маскируемые поля = помеченные 🔒 измерения, которые сейчас в
  // группировке. Маскировка имеет смысл только в режиме сводной таблицы:
  // без группировки в Claude уходят сырые строки и ничего не токенизируется.
  function effectiveConfidential(): string[] {
    if (analysisGroupBy.length === 0) return [];
    return analysisGroupBy.filter((c) => confidentialDraft.includes(c));
  }

  async function handlePreview(): Promise<AnonymizePreview> {
    if (!project) throw new Error("Проект не загружен");
    const activePromptText = promptDraft.trim();
    const filterConditions = buildGlobalFilterConditions(
      project.filtersConfig,
      project.filterValues,
    );
    const rows = await fetchProjectRows(filterConditions);
    const res = await fetch("/api/ai/anonymize-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        rows,
        confidentialColumns: effectiveConfidential(),
        prompt: activePromptText,
      }),
    });
    const j = (await res.json()) as AnonymizePreview & { error?: string };
    if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
    // Диагностика дублей строк (актуальна при группировке — там SUM завышается).
    if (analysisGroupBy.length > 0) {
      try {
        j.duplication = detectRowDuplication(
          await fetchRawRows(filterConditions, 300),
        );
      } catch {
        // диагностика не критична — молча пропускаем
      }
    }
    return j;
  }

  async function handleAnalyze(override?: string) {
    if (!project || !dataset || !source) return;
    const prompt = (override ?? promptDraft).trim();
    if (!prompt) {
      toast({ title: "Промпт пустой", variant: "destructive" });
      return;
    }
    const provider = resolveModel(currentModelId).provider;
    if (!isProviderEnabled(provider)) {
      toast({
        title: `${PROVIDERS[provider].label}: интеграция скоро`,
        description: "Пока доступны модели Claude (Anthropic) — выберите их в списке моделей.",
        variant: "destructive",
      });
      return;
    }
    if (!providerKeyMarker(provider)) {
      toast({
        title: `Нет ключа ${PROVIDERS[provider].label}`,
        description: "Добавьте ключ выбранной модели ниже («Модели и ключи»).",
        variant: "destructive",
      });
      return;
    }

    const filterConditions: FilterCondition[] = buildGlobalFilterConditions(
      project.filtersConfig,
      project.filterValues,
    );

    // Предупреждаем (не блокируем), если часть метрик отброшена как небезопасная
    // для запроса — битая формула/имя вычисляемого поля или удалённая колонка.
    if (analysisGroupBy.length > 0 && analysisMetrics.length > 0) {
      const requested = analysisMetrics.filter(
        (m) => !analysisGroupBy.includes(m.column),
      );
      if (safeMetrics(requested).length < requested.length) {
        toast({
          title: "Часть метрик пропущена",
          description:
            "Проверьте формулы/имена вычисляемых полей (подсвечены красным в «Вычисляемые поля»).",
          variant: "destructive",
        });
      }
    }

    setAnalyzing(true);
    setResultMd("");
    setResultMeta(null);
    setPendingPrompt(prompt);
    // Очищаем поле ввода сразу — чтобы было видно, что сообщение «улетело»
    // (появляется пузырём выше). При неудаче ниже текст возвращаем обратно.
    setPromptDraft("");

    try {
      const rows = await fetchProjectRows(filterConditions);
      // Пустая выборка — не зовём Claude (нет данных и не тратим токены).
      if (rows.length === 0) {
        setAnalyzing(false);
        setPendingPrompt(null);
        setPromptDraft(prompt);
        toast({
          title: "Под выбранные фильтры нет данных",
          description:
            "Ослабьте фильтры или измените группировку — сейчас выборка пустая.",
          variant: "destructive",
        });
        return;
      }
      // Защита PII: если в срез попали поля, похожие на персональные данные,
      // которые НЕ замаскированы — спрашиваем подтверждение перед отправкой.
      const piiUnmasked = detectPiiColumns(rows).filter(
        (c) => !effectiveConfidential().includes(c),
      );
      if (piiUnmasked.length > 0) {
        const ok = window.confirm(
          "В срез попали поля, похожие на персональные данные, БЕЗ маскировки:\n" +
            `${piiUnmasked.join(", ")}\n\n` +
            "Они уйдут в AI в открытом виде. Для полей группировки можно нажать 👁 " +
            "(станет 🔒). Всё равно отправить?",
        );
        if (!ok) {
          setAnalyzing(false);
          setPendingPrompt(null);
          setPromptDraft(prompt);
          return;
        }
      }
      const sentRows = rows;
      const csv = rowsToCsv(sentRows);
      // Описываем включённые столбцы датасета (имена столбцов не секретны;
      // реальные значения внутри описаний маскируются на сервере вместе с данными).
      const keptColumns = dataset.columns.filter((c) => c.enabled);
      // Маскировка — ТОЛЬКО для помеченных 🔒 измерений активной группировки.
      // Сервер сам токенизирует их значения перед отправкой в Claude и вернёт
      // реальные имена в ответе. Без группировки маскировки нет.
      const confidentialColumns = effectiveConfidential();
      const anonOn = confidentialColumns.length > 0;

      const ac = new AbortController();
      abortRef.current = ac;

      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          dataType: "dataset",
          dataId: dataset.id,
          columns: keptColumns,
          csv,
          model: currentModelId,
          businessContext: dataset.businessContext,
          columnDescriptions: [
            ...keptColumns
              .filter(
                (c) =>
                  !!(c.businessContext?.trim() || c.aiDescription?.trim()),
              )
              .map((c) => ({
                name: c.name,
                description:
                  (c.businessContext?.trim() || c.aiDescription) ?? "",
              })),
            ...(dataset.calculatedFields ?? [])
              .filter((c) => c.aiDescription?.trim())
              .map((c) => ({ name: c.name, description: c.aiDescription! })),
          ],
          // Воронку шлём только если пользователь включил её в контексте —
          // иначе она не должна влиять на ответ (это фоновый контекст).
          funnelSteps: includeFunnel ? dataset.funnelSteps : undefined,
          additionalContext: undefined,
          filters: filterConditions,
          filteredRowCount: sentRows.length,
          // Сообщаем серверу/Claude, что это сводка по измерениям (а не сырьё).
          groupingDimensions:
            analysisGroupBy.length > 0 ? analysisGroupBy : undefined,
          projectId: project.id,
          ...(anonOn ? { confidentialColumns, rows: sentRows } : {}),
        }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accText = "";
      let doneMeta: {
        cost?: number;
        model?: AIModelId;
        input?: number;
        output?: number;
      } | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const dataLine = chunk
            .split("\n")
            .find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload) continue;
          try {
            const parsed = JSON.parse(payload) as {
              type?: string;
              content?: string;
              error?: string;
              cost?: number;
              model?: AIModelId;
              usage?: { input?: number; output?: number };
            };
            if (parsed.type === "text" && parsed.content) {
              accText += parsed.content;
              setResultMd(accText);
            } else if (parsed.type === "done") {
              doneMeta = {
                cost: parsed.cost,
                model: parsed.model,
                input: parsed.usage?.input,
                output: parsed.usage?.output,
              };
              setResultMeta(doneMeta);
            } else if (parsed.type === "error") {
              throw new Error(parsed.error ?? "Неизвестная ошибка");
            }
          } catch (err) {
            if (err instanceof SyntaxError) continue;
            throw err;
          }
        }
      }

      if (accText && doneMeta) {
        try {
          await createRun(project.id, {
            prompt,
            response: accText,
            cost: doneMeta.cost ?? 0,
            model: doneMeta.model ?? currentModelId,
            inputTokens: doneMeta.input ?? 0,
            outputTokens: doneMeta.output ?? 0,
            filtersSnapshot: filterConditions,
          });
          // Успешно сохранили — убираем «живой» пузырь, ответ покажется как
          // запись истории (чтобы не было дубля в ленте).
          setResultMd("");
          setResultMeta(null);
        } catch (e) {
          toast({
            title: "Ответ получен, но история не сохранилась",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          });
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      // Не потеряли набранный текст при ошибке — возвращаем в поле ввода.
      setPromptDraft((cur) => cur || prompt);
      toast({
        title: "Ошибка анализа",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
      setPendingPrompt(null);
      abortRef.current = null;
    }
  }

  async function handleDeleteRun(r: AIProjectRun) {
    if (!confirm("Удалить этот запуск?")) return;
    try {
      await deleteRun(r.id);
      toast({ title: "Запуск удалён" });
    } catch (e) {
      toast({
        title: "Не удалось удалить",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  if (loading || !project) {
    return (
      <PageContainer title="AI-проект">
        <LoadingState label="Загружаем проект…" />
      </PageContainer>
    );
  }

  if (!dataset || !source) {
    return (
      <PageContainer
        title={project.name}
        actions={
          <Button asChild variant="ghost">
            <Link href="/ai-analysis">
              <ArrowLeft />К проектам
            </Link>
          </Button>
        }
      >
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Датасет, привязанный к этому проекту, недоступен. Возможно он был
            удалён. Удалите проект или создайте новый.
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const grouped = analysisGroupBy.length > 0;
  const enabledCols = dataset.columns.filter((c) => c.enabled);
  // Сколько метрик реально уйдёт: явные, либо (по умолчанию) все числовые.
  const effectiveMetricsCount =
    analysisMetrics.length > 0
      ? analysisMetrics.length
      : enabledCols.filter(
          (c) =>
            !analysisGroupBy.includes(c.name) &&
            (c.datasetType === "integer" || c.datasetType === "float"),
        ).length;
  // «Включено»: в режиме сводки — измерения + метрики, иначе все поля датасета.
  const includedCount = grouped
    ? analysisGroupBy.length + effectiveMetricsCount
    : enabledCols.length;
  // «В маске» = помеченные 🔒 измерения активной группировки.
  const maskedCount = effectiveConfidential().length;

  const aiAvatar = (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-iris-bright">
      <Sparkles className="h-4 w-4" />
    </span>
  );
  const userAvatar = (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-hair-2 bg-accent font-mono text-[11px] text-muted-foreground">
      Вы
    </span>
  );

  const filtersSlot = (
    <ProjectFilters
      dataset={dataset}
      source={source}
      filtersConfig={project.filtersConfig}
      filterValues={project.filterValues}
      onConfigChange={handleFiltersConfigChange}
      onValueChange={handleFilterValueChange}
      onResetValues={handleResetFilterValues}
    />
  );

  const groupingSlot = (
    <AiGroupingZone
      dataset={dataset}
      groupBy={analysisGroupBy}
      maskedSet={new Set(confidentialDraft)}
      onAdd={addDimension}
      onRemove={removeDimension}
      onReorder={reorderDimensions}
      onToggleMask={toggleMask}
    />
  );

  const metricsSlot = (
    <AiMetricsZone
      dataset={dataset}
      groupBy={analysisGroupBy}
      metrics={analysisMetrics}
      onChange={setMetricsConfig}
    />
  );

  const calcSlot = (
    <AiCalcFieldsZone
      dataset={dataset}
      metrics={analysisMetrics}
      onMetricsChange={setMetricsConfig}
    />
  );

  const orderedRuns = [...runs].reverse();

  // Панель «Построить график» по последнему срезу (lastRows). Выносим в общий
  // блок и показываем под самым свежим ответом в истории — раньше она висела в
  // «живом» пузыре под условием `resultMeta && !analyzing`, которое никогда не
  // выполняется (resultMeta обнуляется до того, как analyzing станет false),
  // поэтому кнопка была недостижима. chartSpec устойчив и к несгруппированным
  // данным, так что график доступен и для сырых срезов.
  const chartPanel = chartSpec ? (
    <div className="mt-3 rounded-xl border border-border bg-card/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setShowChart((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground"
        >
          <BarChart3 className="h-4 w-4 text-brand-500" />
          {showChart ? "Скрыть график" : "Построить график"}
        </button>
        {showChart && (
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                ["bar", "Столбцы"],
                ["line", "Линия"],
                ["area", "Область"],
                ["pie", "Круговая"],
              ] as const
            ).map(([t, label]) => (
              <Button
                key={t}
                variant={chartType === t ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setChartType(t)}
              >
                {label}
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onDownloadChartPng()}
            >
              <ImageIcon />
              PNG
            </Button>
          </div>
        )}
      </div>
      {showChart && (
        <div ref={chartRef} className="rounded-lg bg-card p-2">
          <ChartRenderer
            type={chartType}
            data={chartSpec.data}
            xAxis={chartSpec.xKey}
            yAxis={chartSpec.yAxis}
          />
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="flex flex-1 flex-col">
      {/* Топбар: назад · имя проекта (редактируемое) · модель · тоггл контекста */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 lg:px-6">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9">
          <Link href="/ai-analysis" aria-label="К проектам">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-gradient-to-br from-card to-muted/30 text-primary">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          {editingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") {
                    setEditingName(false);
                    setNameDraft(project.name);
                  }
                }}
                autoFocus
                className="h-8 text-base font-semibold"
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={handleSaveName}
                disabled={savingName}
              >
                {savingName ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 text-success" />
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => {
                  setEditingName(false);
                  setNameDraft(project.name);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="group flex items-center gap-2 text-left"
            >
              <h1 className="truncate text-lg font-semibold tracking-tight">
                {project.name}
              </h1>
              <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
          <div className="truncate font-mono text-[11px] text-faint">
            {dataset.name}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ModelSelector value={currentModelId} onChange={handleModelChange} />
          <Button
            variant={cfgOpen ? "outline" : "default"}
            size="sm"
            onClick={() => setCfgOpen((v) => !v)}
          >
            <Shield className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {cfgOpen ? "Скрыть контекст" : "Контекст"}
            </span>
          </Button>
        </div>
      </div>

      {/* Тело: панель контекста + чат */}
      <div className="flex flex-1 flex-col gap-4 p-4 lg:h-[calc(100vh-7rem)] lg:flex-row lg:gap-5 lg:p-6">
        {cfgOpen && (
          <AiContextPanel
            dataset={dataset}
            groupingSlot={groupingSlot}
            groupingCount={analysisGroupBy.length}
            metricsSlot={metricsSlot}
            metricsCount={analysisMetrics.length}
            calcSlot={calcSlot}
            calcCount={(dataset.calculatedFields ?? []).length}
            filtersSlot={filtersSlot}
            filtersCount={project.filtersConfig.length}
            grouped={grouped}
            included={includedCount}
            masked={maskedCount}
            cost={estimatedCost}
            includeFunnel={includeFunnel}
            onIncludeFunnelChange={handleIncludeFunnelChange}
            onPreview={handlePreview}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col lg:h-full">
          {!anyProviderConfigured && (
            <div className="mb-3">
              <LlmOnboarding />
            </div>
          )}

          {/* Лента */}
          <div
            ref={scrollRef}
            className="no-scrollbar min-h-0 flex-1 overflow-y-auto"
          >
            <div className="mx-auto flex max-w-3xl flex-col gap-5 py-2">
              {orderedRuns.length === 0 &&
                !analyzing &&
                !resultMd &&
                !pendingPrompt && (
                  <>
                    <div className="flex gap-3">
                      {aiAvatar}
                      <div className="pt-1 text-sm leading-relaxed text-foreground">
                        Готов к анализу. Слева в «Контексте» соберите данные:
                        добавьте измерения для сводки (и при необходимости
                        замаскируйте{" "}
                        <Lock className="inline h-3.5 w-3.5 text-warning" />{" "}
                        чувствительные поля), задайте метрики и фильтры — затем
                        спросите. Я работаю только с тем, что вы разрешили.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pl-11">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            setPromptDraft(s);
                            void handleAnalyze(s);
                          }}
                          className="rounded-xl border border-hair-2 bg-card px-3.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </>
                )}

              {orderedRuns.map((r, idx) => {
                const open = expandedRuns[r.id] !== false;
                // Инструменты (Excel со срезом + график) показываем только под
                // самым свежим ответом и только когда нет «живого» пузыря —
                // lastRows/chartSpec соответствуют именно последнему запросу.
                const showLatestTools =
                  idx === orderedRuns.length - 1 &&
                  !analyzing &&
                  !resultMd &&
                  !pendingPrompt;
                return (
                  <div key={r.id} className="flex flex-col gap-4">
                    <div className="flex flex-row-reverse gap-3">
                      {userAvatar}
                      <div className="max-w-[80%] rounded-2xl border border-border bg-muted px-4 py-2.5 text-sm">
                        {r.prompt}
                      </div>
                    </div>
                    <div className="flex gap-3">
                      {aiAvatar}
                      <div className="min-w-0 flex-1">
                        <div className="mb-1.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-faint">
                          <span>{formatDate(r.createdAt)}</span>
                          <span>·</span>
                          <span>{resolveModel(r.model).label}</span>
                          <span>·</span>
                          <span>{formatCurrency(r.cost)}</span>
                          <span>·</span>
                          <span>
                            {r.inputTokens.toLocaleString("ru-RU")} +{" "}
                            {r.outputTokens.toLocaleString("ru-RU")} tok
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedRuns((p) => ({ ...p, [r.id]: !open }))
                            }
                            className="ml-1 text-faint hover:text-foreground"
                            title={open ? "Свернуть" : "Развернуть"}
                          >
                            <ChevronRight
                              className={cn(
                                "h-3.5 w-3.5 transition-transform",
                                open && "rotate-90",
                              )}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRun(r)}
                            className="ml-auto text-faint hover:text-destructive"
                            title="Удалить"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {open && (
                          <>
                            <div className="prose prose-sm prose-invert max-w-none">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {r.response}
                              </ReactMarkdown>
                            </div>
                            <div className="mt-2">
                              <ExportPanel
                                markdown={r.response}
                                datasetName={dataset.name}
                                prompt={r.prompt}
                                {...(showLatestTools && lastRows.length > 0
                                  ? {
                                      rows: lastRows,
                                      chartPngProvider: captureChartPng,
                                    }
                                  : {})}
                              />
                            </div>
                            {showLatestTools && chartPanel}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {pendingPrompt && (
                <div className="flex flex-row-reverse gap-3">
                  {userAvatar}
                  <div className="max-w-[80%] rounded-2xl border border-border bg-muted px-4 py-2.5 text-sm">
                    {pendingPrompt}
                  </div>
                </div>
              )}

              {(analyzing || resultMd) && (
                <div className="flex gap-3">
                  {aiAvatar}
                  <div className="min-w-0 flex-1">
                    {analyzing && !resultMd ? (
                      <div className="flex items-center gap-2 pt-1 text-sm text-faint">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="font-mono">
                          применяю {project.filtersConfig.length} фильтра ·
                          маскирую {maskedCount} поля · готовлю срез…
                        </span>
                      </div>
                    ) : (
                      <>
                        <AnalysisResult
                          markdown={resultMd || "…"}
                          streaming={analyzing}
                        />
                        {resultMeta && !analyzing && (
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <div className="font-mono text-[11px] text-faint">
                              {resolveModel(resultMeta.model ?? currentModelId).label}{" "}
                              · {(resultMeta.input ?? 0).toLocaleString("ru-RU")}{" "}
                              + {(resultMeta.output ?? 0).toLocaleString("ru-RU")}{" "}
                              tok · {formatCurrency(resultMeta.cost ?? 0)}
                            </div>
                            <ExportPanel
                              markdown={resultMd}
                              datasetName={dataset.name}
                              prompt={activePrompt}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Ввод */}
          <div className="mx-auto w-full max-w-3xl pt-3">
            <div className="mb-2 flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSavePrompt}
                disabled={savingPrompt}
              >
                {savingPrompt ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Сохранить промпт
              </Button>
            </div>

            {sentRowCount !== null && sentRowCount > 500 && (
              <div className="mb-2 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  В срез попало {sentRowCount.toLocaleString("ru-RU")} строк
                  (больше 500). На больших объёмах AI может отвечать с ошибками
                  или неточностями (ограничения модели), и стоимость выше — при
                  необходимости сузьте данные фильтрами.
                </span>
              </div>
            )}

            {unmaskedPii.length > 0 && (
              <div className="mb-2 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Похоже, в срез попали персональные данные без маскировки:{" "}
                  <span className="font-medium">{unmaskedPii.join(", ")}</span>.
                  Они уйдут в AI как есть. Для полей группировки нажмите 👁 (станет
                  🔒), либо уберите их из среза.
                </span>
              </div>
            )}

            <div className="surface flex items-end gap-2 p-2">
              <Textarea
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleAnalyze();
                  }
                }}
                rows={1}
                placeholder="Спросите AI о ваших данных…"
                className="max-h-40 min-h-[44px] flex-1 resize-none border-0 bg-transparent text-sm focus-visible:ring-0"
              />
              <Button
                variant="gradient"
                size="icon"
                onClick={() => void handleAnalyze()}
                disabled={analyzing || !activePrompt.trim()}
              >
                {analyzing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2 font-mono text-[11px] text-faint">
              {maskedCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Shield className="h-3 w-3 text-success" />
                  конфиденциальность активна
                </span>
              )}
              <span>
                · {modelInfo.label} · ~{formatCurrency(estimatedCost)} / запрос
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
