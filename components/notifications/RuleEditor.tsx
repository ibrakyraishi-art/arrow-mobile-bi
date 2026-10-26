"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  Plus,
  Send,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { TemplateEditorDialog } from "@/components/notifications/TemplatesTab";
import type {
  AlertAnalysisConfig,
  AlertCondition,
  AlertRule,
  CalculatedField,
  Dataset,
  DatasetColumn,
  FilterCondition,
  NotificationTemplate,
  PivotValueConfig,
  ScheduleConfig,
  TelegramConnection,
} from "@/lib/types";
import { useDatasetStore } from "@/stores/datasetStore";
import { cn } from "@/lib/utils";
import { ConditionsEditor } from "./ConditionsEditor";
import { MultiColumnPicker } from "./MultiColumnPicker";
import { QuickCalcDialog } from "./QuickCalcDialog";
import { RulePreviewBlock } from "./RulePreviewBlock";
import { RuleSummary } from "./RuleSummary";
import { MetricsEditor } from "./MetricsEditor";
import { ValueFiltersEditor } from "./ValueFiltersEditor";
import { LiveTablePreview } from "./LiveTablePreview";
import { DateRangePicker } from "@/components/dashboards/DateRangePicker";

/** Часовой пояс зафиксирован — Москва, без выбора. */
const TIMEZONE = "Europe/Moscow";

const WEEK_DAYS = [
  { value: 1, label: "Пн" },
  { value: 2, label: "Вт" },
  { value: 3, label: "Ср" },
  { value: 4, label: "Чт" },
  { value: 5, label: "Пт" },
  { value: 6, label: "Сб" },
  { value: 0, label: "Вс" },
];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

const STEPS: { n: number; title: string; hint: string }[] = [
  { n: 1, title: "Датасет и период", hint: "Что анализируем и за какой срок." },
  { n: 2, title: "Строки (группировка)", hint: "По каким полям резать таблицу — каждое поле это уровень строк." },
  { n: 3, title: "Метрики и формулы", hint: "Какие цифры показать в таблице (Расход, Триалы, CPA…)." },
  { n: 4, title: "Фильтры", hint: "Что оставить в таблице и при каких порогах вообще слать алерт." },
  { n: 5, title: "Сортировка и Топ-N", hint: "Что показать вверху и сколько строк, чтобы не вываливать сотни." },
  { n: 6, title: "Сообщение", hint: "Куда слать и по какому шаблону — вставьте {table} и проверьте превью." },
  { n: 7, title: "Расписание", hint: "В какие дни недели и во сколько отправлять (время по Москве)." },
  { n: 8, title: "Проверка", hint: "Проверьте сводку и при желании отправьте тест в Telegram." },
];
const TOTAL = STEPS.length;

/** Ключ авто-черновика мастера создания правила (только для новых правил). */
const DRAFT_KEY = "alert-rule-wizard-draft:v1";

interface WizardDraft {
  step?: number;
  maxStep?: number;
  name?: string;
  description?: string;
  datasetId?: string;
  groupBy?: string[];
  periodMode?: "days" | "range";
  periodDays?: string;
  dateFrom?: string;
  dateTo?: string;
  dateColumn?: string;
  minSpend?: string;
  metrics?: PivotValueConfig[];
  valueFilters?: FilterCondition[];
  conditions?: AlertCondition[];
  sortColumn?: string;
  sortDir?: "asc" | "desc";
  topNEnabled?: boolean;
  topN?: string;
  telegramConnectionId?: string;
  templateId?: string;
  tagUsers?: string;
  scheduleDays?: number[];
  scheduleTime?: string;
}

function readWizardDraft(): WizardDraft | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as unknown;
    return d && typeof d === "object" ? (d as WizardDraft) : null;
  } catch {
    return null;
  }
}

function writeWizardDraft(d: WizardDraft) {
  try {
    if (typeof window !== "undefined")
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    // localStorage может быть недоступен (private mode) — молча игнорируем.
  }
}

function clearWizardDraft() {
  try {
    if (typeof window !== "undefined")
      window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rule: AlertRule | null;
  connections: TelegramConnection[];
  templates: NotificationTemplate[];
  onSaved: () => void;
  onTemplatesChanged: () => void;
}

export function RuleEditor({
  open,
  onOpenChange,
  rule,
  connections,
  templates,
  onSaved,
  onTemplatesChanged,
}: Props) {
  const { toast } = useToast();
  const datasets = useDatasetStore((s) => s.datasets);
  const updateDataset = useDatasetStore((s) => s.updateDataset);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [datasetId, setDatasetId] = useState<string>("");
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [periodMode, setPeriodMode] = useState<"days" | "range">("days");
  // Храним как строку, чтобы поле можно было очистить и ввести другое число
  // (число в state форсировало бы 1 при пустом вводе).
  const [periodDays, setPeriodDays] = useState("7");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateColumn, setDateColumn] = useState<string>(""); // "" = авто
  const [minSpend, setMinSpend] = useState<string>("");
  const [metrics, setMetrics] = useState<PivotValueConfig[]>([]);
  const [valueFilters, setValueFilters] = useState<FilterCondition[]>([]);
  const [conditions, setConditions] = useState<AlertCondition[]>([]);
  const [sortColumn, setSortColumn] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [topNEnabled, setTopNEnabled] = useState(false);
  const [topN, setTopN] = useState<string>("20");
  const [telegramConnectionId, setTelegramConnectionId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [tagUsers, setTagUsers] = useState("");
  const [scheduleDays, setScheduleDays] = useState<number[]>(ALL_DAYS);
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);

  const [calcOpen, setCalcOpen] = useState(false);
  const [calcTarget, setCalcTarget] =
    useState<((name: string) => void) | null>(null);
  // Редактируемое вычисляемое поле (null — создание нового).
  const [calcEditing, setCalcEditing] = useState<CalculatedField | null>(null);

  // Визард
  const [step, setStep] = useState(1);
  const [maxStep, setMaxStep] = useState(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  /** Показан баннер «восстановлен черновик» (только для нового правила). */
  const [draftRestored, setDraftRestored] = useState(false);

  // Инициализируем форму один раз за «открытие». Иначе при обновлении пропсов
  // (например, после создания шаблона из шага «Сообщение» список templates
  // меняется) эффект бы перезапустился и сбросил весь введённый прогресс визарда.
  const initedRef = useRef(false);
  // Готовность к автосейву черновика (после инициализации) — чтобы не писать
  // черновик в момент восстановления значений.
  const readyRef = useRef(false);

  function applyDefaults() {
    setName("");
    setDescription("");
    setDatasetId(datasets[0]?.id ?? "");
    setGroupBy([]);
    setPeriodMode("days");
    setPeriodDays("7");
    setDateFrom("");
    setDateTo("");
    setMinSpend("");
    setMetrics([]);
    setValueFilters([]);
    setConditions([]);
    setSortColumn("");
    setSortDir("desc");
    setTopNEnabled(false);
    setTopN("20");
    setDateColumn("");
    setTelegramConnectionId(connections[0]?.id ?? "");
    setTemplateId(templates[0]?.id ?? "");
    setTagUsers("");
    setScheduleDays(ALL_DAYS);
    setScheduleTime("09:00");
    setStep(1);
    setMaxStep(1);
  }

  function applyDraft(d: WizardDraft) {
    setName(d.name ?? "");
    setDescription(d.description ?? "");
    setDatasetId(d.datasetId ?? datasets[0]?.id ?? "");
    setGroupBy(Array.isArray(d.groupBy) ? d.groupBy : []);
    setPeriodMode(d.periodMode === "range" ? "range" : "days");
    setPeriodDays(d.periodDays && d.periodDays.trim() ? d.periodDays : "7");
    setDateFrom(d.dateFrom ?? "");
    setDateTo(d.dateTo ?? "");
    setMinSpend(d.minSpend ?? "");
    setMetrics(Array.isArray(d.metrics) ? d.metrics : []);
    setValueFilters(Array.isArray(d.valueFilters) ? d.valueFilters : []);
    setConditions(Array.isArray(d.conditions) ? d.conditions : []);
    setSortColumn(d.sortColumn ?? "");
    setSortDir(d.sortDir === "asc" ? "asc" : "desc");
    setTopNEnabled(d.topNEnabled === true);
    setTopN(d.topN ?? "20");
    setDateColumn(d.dateColumn ?? "");
    setTelegramConnectionId(d.telegramConnectionId ?? connections[0]?.id ?? "");
    setTemplateId(d.templateId ?? templates[0]?.id ?? "");
    setTagUsers(d.tagUsers ?? "");
    setScheduleDays(
      Array.isArray(d.scheduleDays) && d.scheduleDays.length > 0
        ? d.scheduleDays
        : ALL_DAYS,
    );
    setScheduleTime(d.scheduleTime ?? "09:00");
    const s = Math.min(TOTAL, Math.max(1, d.step ?? 1));
    setStep(s);
    setMaxStep(Math.min(TOTAL, Math.max(s, d.maxStep ?? s)));
  }

  useEffect(() => {
    if (!open) {
      initedRef.current = false;
      readyRef.current = false;
      return;
    }
    if (initedRef.current) return;
    initedRef.current = true;
    setStepError(null);
    setTestResult(null);
    setDraftRestored(false);

    if (rule) {
      // Редактирование: всегда из правила, черновик не трогаем.
      setStep(1);
      setMaxStep(TOTAL);
      setName(rule.name ?? "");
      setDescription(rule.description ?? "");
      setDatasetId(rule.datasetId);
      setGroupBy(rule.groupBy);
      setPeriodDays(String(rule.periodDays || 7));
      setMinSpend(
        typeof rule.minSpendFilter === "number"
          ? String(rule.minSpendFilter)
          : "",
      );
      setConditions(rule.conditions);
      setTelegramConnectionId(rule.telegramConnectionId);
      setTemplateId(rule.templateId);
      setTagUsers(rule.tagUsers ?? "");

      const a = rule.analysis;
      setMetrics(a?.metrics ?? []);
      setValueFilters(a?.valueFilters ?? []);
      setSortColumn(a?.sort?.column ?? "");
      setSortDir(a?.sort?.direction ?? "desc");
      setTopNEnabled(typeof a?.topN === "number" && a.topN > 0);
      setTopN(a?.topN ? String(a.topN) : "20");
      setDateColumn(a?.dateColumn ?? "");
      if (a?.dateRange) {
        setPeriodMode("range");
        setDateFrom(a.dateRange.from);
        setDateTo(a.dateRange.to);
      } else {
        setPeriodMode("days");
        setDateFrom("");
        setDateTo("");
      }

      const sched = rule.schedule;
      if (
        (sched?.type === "weekly" || sched?.type === "twice_weekly") &&
        Array.isArray(sched.daysOfWeek) &&
        sched.daysOfWeek.length > 0
      ) {
        setScheduleDays(sched.daysOfWeek);
      } else {
        setScheduleDays(ALL_DAYS);
      }
      setScheduleTime(sched?.time ?? "09:00");
    } else {
      // Новое правило: пробуем восстановить черновик.
      const draft = readWizardDraft();
      const hasContent =
        !!draft &&
        ((draft.name ?? "").trim().length > 0 ||
          (Array.isArray(draft.groupBy) && draft.groupBy.length > 0) ||
          (Array.isArray(draft.metrics) && draft.metrics.length > 0) ||
          (draft.step ?? 1) > 1);
      if (draft && hasContent) {
        applyDraft(draft);
        setDraftRestored(true);
      } else {
        applyDefaults();
      }
    }
    // Со следующего тика разрешаем автосейв черновика.
    readyRef.current = true;
  }, [open, rule, connections, templates, datasets]);

  // Автосейв черновика (только для нового правила, пока открыт мастер).
  // Дебаунс, чтобы не писать localStorage на каждый кадр.
  useEffect(() => {
    if (!open || rule || !readyRef.current) return;
    const t = setTimeout(() => {
      writeWizardDraft({
        step,
        maxStep,
        name,
        description,
        datasetId,
        groupBy,
        periodMode,
        periodDays,
        dateFrom,
        dateTo,
        dateColumn,
        minSpend,
        metrics,
        valueFilters,
        conditions,
        sortColumn,
        sortDir,
        topNEnabled,
        topN,
        telegramConnectionId,
        templateId,
        tagUsers,
        scheduleDays,
        scheduleTime,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [
    open,
    rule,
    step,
    maxStep,
    name,
    description,
    datasetId,
    groupBy,
    periodMode,
    periodDays,
    dateFrom,
    dateTo,
    dateColumn,
    minSpend,
    metrics,
    valueFilters,
    conditions,
    sortColumn,
    sortDir,
    topNEnabled,
    topN,
    telegramConnectionId,
    templateId,
    tagUsers,
    scheduleDays,
    scheduleTime,
  ]);

  function startFresh() {
    clearWizardDraft();
    setDraftRestored(false);
    setStepError(null);
    setTestResult(null);
    applyDefaults();
  }

  /** Явно сохранить черновик и закрыть мастер (для нового правила). */
  function saveDraftAndClose() {
    writeWizardDraft({
      step,
      maxStep,
      name,
      description,
      datasetId,
      groupBy,
      periodMode,
      periodDays,
      dateFrom,
      dateTo,
      dateColumn,
      minSpend,
      metrics,
      valueFilters,
      conditions,
      sortColumn,
      sortDir,
      topNEnabled,
      topN,
      telegramConnectionId,
      templateId,
      tagUsers,
      scheduleDays,
      scheduleTime,
    });
    toast({
      title: "Черновик сохранён",
      description: "Продолжите позже — данные восстановятся при открытии.",
      variant: "success",
    });
    onOpenChange(false);
  }

  const dataset: Dataset | undefined = useMemo(
    () => datasets.find((d) => d.id === datasetId),
    [datasets, datasetId],
  );

  // Группировать можно по любому полю датасета: все столбцы (включая
  // выключенные) + вычисляемые поля (ƒx).
  const groupableOptions = useMemo(() => {
    if (!dataset) return [] as { name: string; hint?: string }[];
    const out = dataset.columns.map((c) => ({
      name: c.name,
      hint:
        c.businessContext ||
        c.description ||
        (c.enabled === false ? "выключенная колонка" : undefined),
    }));
    for (const cf of dataset.calculatedFields ?? []) {
      out.push({ name: cf.name, hint: `ƒx ${cf.formula}` });
    }
    return out;
  }, [dataset]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId),
    [templates, templateId],
  );

  // Столбец даты: что выберет «Авто» + список всех колонок (дата/дата-время сверху).
  const autoDateColumn = useMemo(
    () => (dataset ? autoDetectDateColumn(dataset) : null),
    [dataset],
  );
  const dateColumnOptions = useMemo(() => {
    if (!dataset) return [] as { name: string; isDateType: boolean }[];
    return dataset.columns
      .filter((c) => c.enabled !== false)
      .map((c) => ({
        name: c.name,
        isDateType: c.datasetType === "date" || c.datasetType === "datetime",
      }))
      .sort((a, b) => Number(b.isDateType) - Number(a.isDateType));
  }, [dataset]);

  const sortOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    for (const g of groupBy) opts.push({ value: g, label: g });
    for (const m of metrics) {
      opts.push({
        value: `${m.aggregation}(${m.column})`,
        label:
          m.aggregation === "SUM" ? m.column : `${m.column} (${m.aggregation})`,
      });
    }
    return opts;
  }, [groupBy, metrics]);

  // Минимум для сохранения правила (бэкенд требует только эти поля).
  // Доставка (бот+шаблон) необязательна — её можно привязать позже.
  const canSaveNow = useMemo(
    () =>
      Boolean(
        name.trim() &&
          datasetId &&
          groupBy.length > 0 &&
          !(periodMode === "range" && (!dateFrom || !dateTo)),
      ),
    [
      name,
      datasetId,
      groupBy,
      periodMode,
      dateFrom,
      dateTo,
    ],
  );

  function buildSchedule(): ScheduleConfig {
    const days = scheduleDays.length > 0 ? [...scheduleDays].sort() : ALL_DAYS;
    const isEveryDay = days.length === 7;
    return isEveryDay
      ? { type: "daily", time: scheduleTime, timezone: TIMEZONE }
      : {
          type: "weekly",
          time: scheduleTime,
          daysOfWeek: days,
          timezone: TIMEZONE,
        };
  }

  function buildAnalysis(): AlertAnalysisConfig {
    const dateRange =
      periodMode === "range" && dateFrom && dateTo
        ? { from: dateFrom, to: dateTo }
        : null;
    const topNVal = topNEnabled ? Math.max(1, Math.floor(Number(topN) || 0)) : 0;
    // Сортировка валидна только если колонка ещё есть среди опций (метрику/
    // группировку могли убрать после выбора). Иначе не отправляем sort.
    const sortValid =
      sortColumn && sortOptions.some((o) => o.value === sortColumn);
    return {
      metrics,
      valueFilters,
      sort: sortValid ? { column: sortColumn, direction: sortDir } : null,
      topN: topNVal > 0 ? topNVal : null,
      dateRange,
      dateColumn: dateColumn || null,
    };
  }

  function buildPayload(): Record<string, unknown> {
    return {
      name: name.trim(),
      description: description.trim(),
      isActive: rule?.isActive ?? true,
      createdBy: rule?.createdBy ?? "manual",
      datasetId,
      groupBy,
      periodDays: Number(periodDays) || 7,
      minSpendFilter: minSpend.trim() === "" ? null : Number(minSpend),
      conditions,
      telegramConnectionId,
      templateId,
      tagUsers,
      schedule: buildSchedule(),
      analysis: buildAnalysis(),
    };
  }

  /** Payload для отправки/превью сообщения — требует подключение и шаблон. */
  function buildMessagePayload(): Record<string, unknown> | null {
    const missing: string[] = [];
    if (!datasetId) missing.push("датасет");
    if (groupBy.length === 0) missing.push("группировку");
    if (!telegramConnectionId) missing.push("Telegram-подключение");
    if (!templateId) missing.push("шаблон");
    if (missing.length > 0) {
      toast({
        title: "Не хватает данных",
        description: `Заполните: ${missing.join(", ")}`,
        variant: "destructive",
      });
      return null;
    }
    return buildPayload();
  }

  /** Payload для превью таблицы — достаточно датасета и группировки. */
  function buildTablePayload(): Record<string, unknown> | null {
    if (!datasetId || groupBy.length === 0) return null;
    if (periodMode === "range" && (!dateFrom || !dateTo)) return null;
    return buildPayload();
  }

  const tableSignature = useMemo(
    () =>
      JSON.stringify({
        datasetId,
        groupBy,
        periodMode,
        periodDays,
        dateFrom,
        dateTo,
        dateColumn,
        minSpend,
        metrics,
        valueFilters,
        conditions,
        sortColumn,
        sortDir,
        topNEnabled,
        topN,
      }),
    [
      datasetId,
      groupBy,
      periodMode,
      periodDays,
      dateFrom,
      dateTo,
      dateColumn,
      minSpend,
      metrics,
      valueFilters,
      conditions,
      sortColumn,
      sortDir,
      topNEnabled,
      topN,
    ],
  );

  const nextRunHint = useMemo(() => {
    try {
      const next = calcNext(buildSchedule());
      return next ? formatLocal(next, TIMEZONE) : "—";
    } catch {
      return "—";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleDays, scheduleTime]);

  function validateStep(s: number): string | null {
    switch (s) {
      case 1:
        if (!datasetId) return "Выберите датасет.";
        if (periodMode === "range") {
          if (!dateFrom || !dateTo) return "Укажите обе даты диапазона.";
          if (dateFrom > dateTo) return "Дата «с» позже даты «по».";
        } else if (!(Number(periodDays) >= 1)) {
          return "Период должен быть не меньше 1 дня.";
        }
        return null;
      case 2:
        if (groupBy.length === 0)
          return "Добавьте хотя бы одно поле группировки.";
        return null;
      case 3:
        if (metrics.some((m) => !m.column.trim()))
          return "У каждой метрики выберите колонку (или удалите пустую).";
        return null;
      case 4:
        if (valueFilters.some((f) => !f.column.trim()))
          return "У каждого фильтра по значению выберите поле (или удалите пустой).";
        return null;
      case 5:
        if (topNEnabled && !(Number(topN) >= 1))
          return "Топ-N должен быть не меньше 1 (или выключите ограничение).";
        return null;
      case 6:
        // Доставка необязательна — её можно привязать позже (вкладка
        // «Сообщение»). Не блокируем «Далее».
        return null;
      default:
        return null;
    }
  }

  function goNext() {
    const err = validateStep(step);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    const next = Math.min(TOTAL, step + 1);
    setStep(next);
    setMaxStep((m) => Math.max(m, next));
  }

  function goBack() {
    setStepError(null);
    setStep((s) => Math.max(1, s - 1));
  }

  function goTo(n: number) {
    if (n <= maxStep) {
      setStepError(null);
      setStep(n);
    }
  }

  async function save() {
    // Финальная проверка: если какой-то шаг невалиден — перейти к нему и показать почему.
    for (let s = 1; s <= 6; s += 1) {
      const err = validateStep(s);
      if (err) {
        setStep(s);
        setMaxStep((m) => Math.max(m, s));
        setStepError(err);
        return;
      }
    }
    setStepError(null);
    setBusy(true);
    try {
      const url = rule ? `/api/alert-rules/${rule.id}` : "/api/alert-rules";
      const method = rule ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      // Успех — черновик больше не нужен.
      if (!rule) clearWizardDraft();
      toast({ title: "Правило сохранено", variant: "success" });
      onSaved();
    } catch (e) {
      toast({
        title: "Не удалось сохранить",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onTestSend() {
    const payload = buildMessagePayload();
    if (!payload) return;
    setTestBusy(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/alert-rules/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, send: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const r = json.result as {
        status: string;
        matchedCount: number;
        errorText?: string;
      };
      if (r.status === "ok") {
        setTestResult(`✓ Отправлено в Telegram: ${r.matchedCount} строк`);
        toast({ title: "Тест отправлен", variant: "success" });
      } else if (r.status === "no_match") {
        setTestResult("Нет строк по текущим настройкам — сообщение не отправлено.");
        toast({ title: "Нет матчей" });
      } else {
        setTestResult(`✗ Ошибка: ${r.errorText ?? "—"}`);
        toast({
          title: "Ошибка отправки",
          description: r.errorText,
          variant: "destructive",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTestResult(`✗ Ошибка: ${msg}`);
      toast({ title: "Ошибка отправки", description: msg, variant: "destructive" });
    } finally {
      setTestBusy(false);
    }
  }

  function toggleDay(value: number) {
    setScheduleDays((prev) =>
      prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value],
    );
  }

  /** Закрыть мастер: для нового правила с введёнными данными — спросить.
   *  Черновик остаётся в localStorage, чтобы можно было продолжить позже. */
  function requestClose() {
    if (busy) return;
    const hasContent =
      !rule &&
      (name.trim().length > 0 || groupBy.length > 0 || metrics.length > 0);
    if (hasContent) {
      const ok = window.confirm(
        "Закрыть мастер? Введённое сохранится как черновик — при следующем открытии можно продолжить.",
      );
      if (!ok) return;
    }
    onOpenChange(false);
  }

  const current = STEPS[step - 1];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          // Закрыть можно только осознанно (крестик/Отмена) — не по фону.
          if (!v) requestClose();
        }}
      >
        <DialogContent
          className="flex max-h-[92vh] flex-col gap-3 overflow-hidden sm:max-w-3xl"
          // Клик по тёмному фону и Escape НЕ закрывают мастер — чтобы
          // случайно не потерять прогресс создания правила.
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onCloseButtonClick={requestClose}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {rule ? `Редактирование: ${rule.name}` : "Создание правила"}
            </DialogTitle>
          </DialogHeader>

          {/* Прогресс */}
          <div className="shrink-0 overflow-x-auto">
            <div className="flex min-w-max items-center gap-1">
              {STEPS.map((stp, i) => {
                const done = stp.n < step;
                const active = stp.n === step;
                const reachable = stp.n <= maxStep;
                return (
                  <div key={stp.n} className="flex items-center">
                    <button
                      type="button"
                      disabled={!reachable}
                      onClick={() => goTo(stp.n)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-2 py-1 text-xs transition-colors",
                        active
                          ? "bg-brand-500/15 text-brand-500"
                          : reachable
                            ? "text-muted-foreground hover:text-foreground"
                            : "text-muted-foreground/40 cursor-not-allowed",
                      )}
                      title={stp.title}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
                          active
                            ? "border-brand-500 bg-brand-500 text-background"
                            : done
                              ? "border-brand-500/50 text-brand-500"
                              : "border-border",
                        )}
                      >
                        {done ? <Check className="h-3 w-3" /> : stp.n}
                      </span>
                      <span className="hidden whitespace-nowrap sm:inline">
                        {stp.title}
                      </span>
                    </button>
                    {i < STEPS.length - 1 && (
                      <span className="mx-0.5 h-px w-3 bg-border" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Тело шага (скроллится) */}
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {draftRestored && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                <span>Восстановлен черновик прошлого создания правила.</span>
                <button
                  type="button"
                  onClick={startFresh}
                  className="font-medium underline underline-offset-2 hover:text-warning"
                >
                  Начать заново
                </button>
              </div>
            )}
            <div className="rounded-lg border border-brand-500/30 bg-brand-500/5 px-3 py-2">
              <div className="text-sm font-semibold">
                Шаг {step} из {TOTAL}: {current.title}
              </div>
              <p className="text-xs text-muted-foreground">{current.hint}</p>
            </div>

            <div className="mt-4">{renderStep()}</div>
          </div>

          {/* Низ: ошибка + навигация */}
          <div className="shrink-0 space-y-2 border-t border-border pt-3">
            {stepError && (
              <p className="text-sm text-destructive">{stepError}</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={requestClose}
                  disabled={busy}
                >
                  Отмена
                </Button>
                {!rule && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={saveDraftAndClose}
                    disabled={busy}
                    title="Сохранить введённое и продолжить позже"
                  >
                    Сохранить как черновик
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {step > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={goBack}
                    disabled={busy}
                  >
                    Назад
                  </Button>
                )}
                {step < TOTAL && canSaveNow && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={save}
                    disabled={busy}
                    title="Сохранить правило, не доходя до конца мастера"
                  >
                    {busy ? <Loader2 className="animate-spin" /> : null}
                    Сохранить сейчас
                  </Button>
                )}
                {step < TOTAL && (
                  <Button type="button" variant="gradient" onClick={goNext}>
                    Далее
                  </Button>
                )}
                {step === TOTAL && (
                  <Button
                    type="button"
                    variant="gradient"
                    onClick={save}
                    disabled={busy}
                  >
                    {busy ? (
                      <>
                        <Loader2 className="animate-spin" />
                        Сохранение…
                      </>
                    ) : (
                      <>
                        <Wand2 />
                        {rule ? "Сохранить" : "Создать правило"}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <TemplateEditorDialog
        open={tplOpen}
        onOpenChange={setTplOpen}
        template={null}
        defaultDatasetId={datasetId}
        onSaved={(t) => {
          setTplOpen(false);
          onTemplatesChanged();
          if (t?.id) setTemplateId(t.id);
        }}
      />

      <QuickCalcDialog
        open={calcOpen}
        onOpenChange={(v) => {
          setCalcOpen(v);
          if (!v) {
            setCalcTarget(null);
            setCalcEditing(null);
          }
        }}
        dataset={dataset}
        editing={calcEditing}
        onCreated={(cf) => {
          calcTarget?.(cf.name);
        }}
      />
    </>
  );

  /** Открыть редактор существующего вычисляемого поля. */
  function editCalcField(field: CalculatedField) {
    setCalcTarget(null);
    setCalcEditing(field);
    setCalcOpen(true);
  }

  /** Удалить вычисляемое поле из датасета + подчистить ссылки в правиле. */
  async function deleteCalcField(field: CalculatedField) {
    if (!dataset) return;
    if (
      !window.confirm(
        `Удалить вычисляемое поле «${field.name}» из датасета? Оно пропадёт из метрик и условий этого и других правил.`,
      )
    )
      return;
    try {
      const next = (dataset.calculatedFields ?? []).filter(
        (f) => f.id !== field.id,
      );
      await updateDataset(dataset.id, { calculatedFields: next });
      // Чистим ссылки на удалённое поле в текущей форме.
      setMetrics((prev) => prev.filter((m) => m.column !== field.name));
      setConditions((prev) => prev.filter((c) => c.metric !== field.name));
      setValueFilters((prev) => prev.filter((f) => f.column !== field.name));
      if (sortColumn === field.name || sortColumn === `SUM(${field.name})`) {
        setSortColumn("");
      }
      toast({ title: `Поле «${field.name}» удалено`, variant: "success" });
    } catch (e) {
      toast({
        title: "Не удалось удалить поле",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  function renderStep() {
    switch (step) {
      case 1:
        return (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Название</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: Дневной отчёт по креативам"
              />
            </div>
            <div className="space-y-2">
              <Label>Датасет</Label>
              <Select value={datasetId} onValueChange={setDatasetId}>
                <SelectTrigger>
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
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Описание (необязательно)</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Что показывает этот отчёт (одна строка)"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Период</Label>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="period-mode"
                    checked={periodMode === "days"}
                    onChange={() => setPeriodMode("days")}
                  />
                  Последние N дней
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="period-mode"
                    checked={periodMode === "range"}
                    onChange={() => setPeriodMode("range")}
                  />
                  Диапазон дат
                </label>
              </div>
              {periodMode === "days" ? (
                <Input
                  type="number"
                  min={1}
                  max={365}
                  className="w-32"
                  value={periodDays}
                  // Не форсируем значение на лету — позволяем очистить поле и
                  // ввести другое число; парсинг/клэмп при сохранении.
                  onChange={(e) =>
                    setPeriodDays(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  onBlur={() => {
                    const n = Number(periodDays);
                    if (!Number.isFinite(n) || n < 1) setPeriodDays("7");
                    else if (n > 365) setPeriodDays("365");
                  }}
                />
              ) : (
                <DateRangePicker
                  label=""
                  value={{ from: dateFrom || undefined, to: dateTo || undefined }}
                  onChange={(v) => {
                    setDateFrom(v.from ?? "");
                    setDateTo(v.to ?? "");
                  }}
                />
              )}
              <div className="mt-2 space-y-1">
                <Label className="text-xs">Поле с датой (для периода)</Label>
                <Select
                  value={dateColumn || "__auto"}
                  onValueChange={(v) => setDateColumn(v === "__auto" ? "" : v)}
                >
                  <SelectTrigger className="w-full md:w-80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto">
                      {autoDateColumn
                        ? `Авто (сейчас: ${autoDateColumn})`
                        : "Авто (столбец даты не найден)"}
                    </SelectItem>
                    {dateColumnOptions.map((c) => (
                      <SelectItem key={c.name} value={c.name}>
                        <span className="font-mono text-xs">{c.name}</span>
                        {c.isDateType ? " · дата" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  По этому столбцу фильтруется период / диапазон дат. «Авто» —
                  движок ищет по имени (day, date, event_date…).
                </p>
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-2">
            <Label>Строки (группировка)</Label>
            <MultiColumnPicker
              variant="summary"
              value={groupBy}
              onChange={setGroupBy}
              options={groupableOptions}
              placeholder="Выберите поля: channel, GEO, code…"
            />
            <p className="text-[11px] text-muted-foreground">
              Каждое поле — уровень строк. Например, channel + GEO даст отдельную
              строку на каждую связку канала и страны. Порядок чипов = порядок
              уровней (перетащите или стрелками).
            </p>
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <MetricsEditor
              dataset={dataset}
              value={metrics}
              onChange={setMetrics}
              onAddCalcField={(insertInto) => {
                setCalcTarget(() => insertInto);
                setCalcEditing(null);
                setCalcOpen(true);
              }}
              onEditCalcField={editCalcField}
              onDeleteCalcField={deleteCalcField}
            />
            {renderTablePreview()}
          </div>
        );

      case 4:
        return (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Фильтры по значениям</Label>
              <ValueFiltersEditor
                dataset={dataset}
                value={valueFilters}
                onChange={setValueFilters}
              />
            </div>
            <div className="space-y-2">
              <Label>Пороги срабатывания</Label>
              <ConditionsEditor
                dataset={dataset}
                ruleGroupBy={groupBy}
                conditions={conditions}
                onChange={setConditions}
                onAddCalcField={(insertInto) => {
                  setCalcTarget(() => insertInto);
                  setCalcEditing(null);
                  setCalcOpen(true);
                }}
              />
              <div className="flex flex-wrap items-end gap-2 pt-1">
                <div className="space-y-1">
                  <Label htmlFor="min-spend" className="text-xs">
                    Минимальный расход ($)
                  </Label>
                  <Input
                    id="min-spend"
                    type="number"
                    min={0}
                    placeholder="без фильтра"
                    className="w-44"
                    value={minSpend}
                    onChange={(e) => setMinSpend(e.target.value)}
                  />
                </div>
              </div>
            </div>
            {renderTablePreview()}
          </div>
        );

      case 5:
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Сортировка</Label>
                <div className="flex gap-2">
                  <Select
                    value={sortColumn || "__none"}
                    onValueChange={(v) =>
                      setSortColumn(v === "__none" ? "" : v)
                    }
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Без сортировки" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Без сортировки</SelectItem>
                      {sortOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={!sortColumn}
                    title={sortDir === "desc" ? "По убыванию" : "По возрастанию"}
                    onClick={() =>
                      setSortDir((d) => (d === "desc" ? "asc" : "desc"))
                    }
                  >
                    {sortDir === "desc" ? <ArrowDown /> : <ArrowUp />}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Показывать строк</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={topNEnabled}
                    onCheckedChange={setTopNEnabled}
                    id="topn-switch"
                  />
                  <Label htmlFor="topn-switch" className="text-sm">
                    Только топ
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    className="w-24"
                    disabled={!topNEnabled}
                    value={topN}
                    onChange={(e) => setTopN(e.target.value)}
                  />
                  {!topNEnabled && (
                    <span className="text-xs text-muted-foreground">
                      показываются все строки
                    </span>
                  )}
                </div>
              </div>
            </div>
            {renderTablePreview()}
          </div>
        );

      case 6:
        return (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                Шаблон — это текст письма в Telegram.
              </span>{" "}
              Внутри ставите переменную{" "}
              <code className="rounded bg-muted px-1 font-mono">{"{table}"}</code>{" "}
              — вместо неё подставится таблица из конструктора. Кого тегать —
              пишите прямо в тексте шаблона (например{" "}
              <code className="rounded bg-muted px-1 font-mono">@user</code>).
              Шаблоны живут в отдельной вкладке «Шаблоны сообщений» и
              переиспользуются в разных правилах.{" "}
              <span className="text-foreground/80">
                Этот шаг можно пропустить — привязать бота и шаблон позже,
                открыв правило на редактирование.
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Telegram-подключение</Label>
                <Select
                  value={telegramConnectionId || "__none"}
                  onValueChange={(v) =>
                    setTelegramConnectionId(v === "__none" ? "" : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите подключение" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">
                      Без отправки (привязать позже)
                    </SelectItem>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} (@{c.botUsername})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Шаблон сообщения</Label>
                {templates.length === 0 ? (
                  <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
                    <span className="text-xs text-muted-foreground">
                      Шаблонов пока нет. Создайте первый — поле уже заполнено
                      готовым текстом с{" "}
                      <code className="rounded bg-muted px-1 font-mono">
                        {"{table}"}
                      </code>
                      .
                    </span>
                    <Button
                      type="button"
                      variant="gradient"
                      size="sm"
                      className="self-start"
                      onClick={() => setTplOpen(true)}
                    >
                      <Plus />
                      Создать сообщение
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Select
                        value={templateId || "__none"}
                        onValueChange={(v) =>
                          setTemplateId(v === "__none" ? "" : v)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите шаблон" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">
                            Без шаблона (привязать позже)
                          </SelectItem>
                          {templates.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setTplOpen(true)}
                    >
                      <Plus />
                      Создать
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {telegramConnectionId && templateId ? (
              <div className="space-y-2">
                <Label>Живое превью сообщения</Label>
                <RulePreviewBlock
                  buildPayload={buildMessagePayload}
                  templateParseMode={selectedTemplate?.parseMode ?? "markdownv2"}
                />
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Превью сообщения появится, когда выберете бота и шаблон. Без них
                правило сохранится, но будет на паузе — включится после привязки
                доставки.
              </p>
            )}
          </div>
        );

      case 7:
        return (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Дни недели</Label>
              <div className="flex flex-wrap gap-2">
                {WEEK_DAYS.map((d) => {
                  const checked = scheduleDays.includes(d.value);
                  return (
                    <button
                      type="button"
                      key={d.value}
                      onClick={() => toggleDay(d.value)}
                      className={cn(
                        "rounded-md border px-3 py-1 text-xs",
                        checked
                          ? "border-brand-500 bg-brand-500/15 text-brand-500"
                          : "border-border bg-background",
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <PresetButton
                  label="Будни"
                  active={sameDays(scheduleDays, WEEKDAYS)}
                  onClick={() => setScheduleDays(WEEKDAYS)}
                />
                <PresetButton
                  label="Выходные"
                  active={sameDays(scheduleDays, WEEKEND)}
                  onClick={() => setScheduleDays(WEEKEND)}
                />
                <PresetButton
                  label="Каждый день"
                  active={sameDays(scheduleDays, ALL_DAYS)}
                  onClick={() => setScheduleDays(ALL_DAYS)}
                />
              </div>
              {scheduleDays.length === 0 && (
                <p className="text-[11px] text-warning">
                  Не выбран ни один день — правило будет приходить каждый день.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="sched-time">Время</Label>
              <Input
                id="sched-time"
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="w-32"
              />
            </div>

            <div className="space-y-2">
              <Label>Часовой пояс</Label>
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                Europe/Moscow (Москва) — фиксировано
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Следующий запуск: <span className="font-mono">{nextRunHint}</span>
            </p>
          </div>
        );

      case 8:
        return (
          <div className="space-y-4">
            <RuleSummary
              datasetId={datasetId}
              datasets={datasets}
              groupBy={groupBy}
              periodDays={Number(periodDays) || 7}
              conditions={conditions}
              minSpendFilter={minSpend}
              telegramConnectionId={telegramConnectionId}
              connections={connections}
              templateId={templateId}
              templates={templates}
              tagUsers={tagUsers}
              schedule={buildSchedule()}
            />
            {!(telegramConnectionId && templateId) && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                Доставка не настроена (нет бота или шаблона). Правило сохранится
                <span className="font-medium"> на паузе</span> — добавьте бота и
                шаблон на шаге «Сообщение» или позже, открыв правило на
                редактирование, чтобы оно начало слать.
              </div>
            )}
            <div className="space-y-2 rounded-lg border border-border bg-muted/10 p-3">
              <Label>Тест в Telegram</Label>
              <p className="text-xs text-muted-foreground">
                Отправит сообщение прямо сейчас по текущим настройкам (в историю
                не пишется). Нужны выбранные бот и шаблон.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={onTestSend}
                disabled={testBusy || !telegramConnectionId || !templateId}
              >
                {testBusy ? <Loader2 className="animate-spin" /> : <Send />}
                Тест в Telegram
              </Button>
              {testResult && (
                <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2 text-xs">
                  {testResult}
                </pre>
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  }

  /**
   * Общий блок «живое превью таблицы» для шагов конструктора.
   * Это функция, возвращающая JSX (НЕ вложенный компонент) — чтобы
   * LiveTablePreview не перемонтировался на каждый ререндер и не терял стейт.
   */
  function renderTablePreview() {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-muted/10 p-3">
        <Label>Превью таблицы</Label>
        <LiveTablePreview
          signature={tableSignature}
          buildPayload={buildTablePayload}
        />
      </div>
    );
  }
}

function PresetButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-0.5 text-xs",
        active
          ? "border-brand-500 bg-brand-500/15 text-brand-500"
          : "border-border bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function sameDays(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/** Зеркало серверного pickDateColumn — чтобы показать, что выберет «Авто». */
function autoDetectDateColumn(dataset: Dataset): string | null {
  const lowered = dataset.columns.map((c) => c.name.toLowerCase());
  for (const c of [
    "day",
    "date",
    "event_date",
    "event_time",
    "ds",
    "ts",
    "created_at",
    "report_date",
  ]) {
    const i = lowered.indexOf(c);
    if (i !== -1) return dataset.columns[i].name;
  }
  return null;
}

export function getNumericColumns(dataset: Dataset): DatasetColumn[] {
  const cols = dataset.columns.filter(
    (c) =>
      c.enabled !== false &&
      (c.datasetType === "integer" || c.datasetType === "float"),
  );
  for (const cf of dataset.calculatedFields ?? []) {
    cols.push({
      name: cf.name,
      clickhouseType: "Float64",
      datasetType: cf.datasetType,
      description: "",
      businessContext: cf.aiDescription ?? "",
      enabled: true,
    });
  }
  return cols;
}

export function getGroupableColumns(dataset: Dataset): DatasetColumn[] {
  return dataset.columns.filter((c) => c.enabled !== false);
}

function calcNext(schedule: ScheduleConfig): Date | undefined {
  if (schedule.type === "trigger_only") return undefined;
  const now = new Date();
  if (schedule.type === "every_n_hours") {
    return new Date(
      now.getTime() +
        Math.max(1, Math.floor(schedule.intervalHours ?? 1)) * 60 * 60 * 1000,
    );
  }
  const [h, m] = (schedule.time ?? "09:00").split(":").map(Number);
  const d = new Date();
  d.setHours(h || 9, m || 0, 0, 0);
  if (d.getTime() <= now.getTime()) {
    d.setDate(d.getDate() + 1);
  }
  if (
    (schedule.type === "weekly" || schedule.type === "twice_weekly") &&
    Array.isArray(schedule.daysOfWeek) &&
    schedule.daysOfWeek.length > 0
  ) {
    for (let i = 0; i < 14; i += 1) {
      if (
        schedule.daysOfWeek.includes(d.getDay()) &&
        d.getTime() > now.getTime()
      ) {
        return d;
      }
      d.setDate(d.getDate() + 1);
    }
  }
  return d;
}

function formatLocal(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}
