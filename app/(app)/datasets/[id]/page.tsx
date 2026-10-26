"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ColumnConfigurator } from "@/components/datasets/ColumnConfigurator";
import { InlineHelp } from "@/components/help/InlineHelp";
import { AiContextEditor } from "@/components/datasets/AiContextEditor";
import { DatasetPreviewPanel } from "@/components/datasets/DatasetPreviewPanel";
import { useDataSourceStore } from "@/stores/dataSourceStore";
import { useDatasetStore } from "@/stores/datasetStore";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/auth-context";
import { logAudit } from "@/lib/audit";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { FILE_TABLE } from "@/lib/file-constants";
import {
  friendlyClickhouseError,
  normalizeClickhouseErrorMessage,
} from "@/lib/clickhouse-errors";
import { mapClickhouseType } from "@/lib/type-mapping";
import { validateFormula } from "@/lib/formula";
import type {
  CalculatedField,
  ColumnInfo,
  Dataset,
  DatasetColumn,
  FunnelStep,
  KpiProfile,
  QueryResultRow,
  TableInfo,
} from "@/lib/types";
import {
  AlertCircle,
  ArrowLeft,
  Calculator,
  ChevronDown,
  ChevronRight,
  Download,
  Info,
  LayoutGrid,
  Loader2,
  RefreshCw,
  Save,
} from "lucide-react";
import Link from "next/link";
import { LoadingState } from "@/components/layout/LoadingState";
import { datasetEditorView } from "./editor-state";

type TablesState = "idle" | "loading" | "error" | "empty" | "ready";

interface TablesDiagnostics {
  sourceId: string;
  url: string;
  status: number | null;
  durationMs: number | null;
  step?: string;
  errorMessage?: string;
}

export default function DatasetEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const datasets = useDatasetStore((s) => s.datasets);
  const datasetsLoaded = useDatasetStore((s) => s.loaded);
  const datasetsError = useDatasetStore((s) => s.error);
  const datasetsUserId = useDatasetStore((s) => s.currentUserId);
  const sources = useDataSourceStore((s) => s.sources);
  const sourcesLoaded = useDataSourceStore((s) => s.loaded);
  const view = datasetEditorView({
    id,
    datasets,
    datasetsLoaded,
    datasetsError,
    sources,
    sourcesLoaded,
  });

  if (view.state === "loading") {
    return (
      <PageContainer icon={<LayoutGrid className="h-5 w-5" />} title="Редактирование датасета">
        <LoadingState label="Загружаем датасет…" />
      </PageContainer>
    );
  }
  if (view.state === "error") {
    return (
      <PageContainer icon={<LayoutGrid className="h-5 w-5" />} title="Датасеты не загрузились">
        <p className="mb-4 text-sm text-muted-foreground">
          {view.message}. Проверьте связь и повторите.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!datasetsUserId}
            onClick={() => {
              if (datasetsUserId) {
                void useDatasetStore.getState().loadFromSupabase(datasetsUserId);
              }
            }}
          >
            <RefreshCw />
            Повторить
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/datasets">
              <ArrowLeft />
              Все датасеты
            </Link>
          </Button>
        </div>
      </PageContainer>
    );
  }
  if (view.state === "not_found") {
    return (
      <PageContainer icon={<LayoutGrid className="h-5 w-5" />} title="Датасет не найден">
        <p className="mb-4 text-sm text-muted-foreground">
          Датасет удалён или ссылка неверная.
        </p>
        <Button variant="outline" asChild>
          <Link href="/datasets">
            <ArrowLeft />
            Все датасеты
          </Link>
        </Button>
      </PageContainer>
    );
  }
  // key: другой датасет — новая форма, инициализированная только его данными.
  const dataset = view.state === "edit" ? view.dataset : undefined;
  return <DatasetEditor key={dataset?.id ?? "new"} existingDataset={dataset} />;
}

function DatasetEditor({ existingDataset }: { existingDataset: Dataset | undefined }) {
  const router = useRouter();
  const sources = useDataSourceStore((s) => s.sources);
  const addDataset = useDatasetStore((s) => s.addDataset);
  const updateDataset = useDatasetStore((s) => s.updateDataset);
  const { toast } = useToast();
  const { user } = useAuth();

  const [name, setName] = useState(existingDataset?.name ?? "");
  const [dataSourceId, setDataSourceId] = useState(
    existingDataset?.dataSourceId ?? sources[0]?.id ?? "",
  );
  const [useSql, setUseSql] = useState(
    existingDataset?.sqlQuery !== null && !!existingDataset?.sqlQuery,
  );
  const [tableName, setTableName] = useState(existingDataset?.table ?? "");
  const [sqlQuery, setSqlQuery] = useState(existingDataset?.sqlQuery ?? "");

  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tablesState, setTablesState] = useState<TablesState>(
    existingDataset?.dataSourceId ? "loading" : "idle",
  );
  const [tablesError, setTablesError] = useState<{
    error: string;
    details?: string;
    step?: string;
  } | null>(null);
  const [tablesDiag, setTablesDiag] = useState<TablesDiagnostics | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [tableSearch, setTableSearch] = useState("");
  const [columns, setColumns] = useState<DatasetColumn[]>(
    existingDataset?.columns ?? [],
  );
  const [preview, setPreview] = useState<QueryResultRow[]>([]);
  const [structureLoading, setStructureLoading] = useState(false);
  const [calculatedFields, setCalculatedFields] = useState<CalculatedField[]>(
    existingDataset?.calculatedFields ?? [],
  );
  const [businessContext, setBusinessContext] = useState<string>(
    existingDataset?.businessContext ?? "",
  );
  // KPI-профиль клиента больше не редактируется в UI: блок убран как лишний —
  // он не уходил в Claude и его никто не читал (даже alert-движок). Значение
  // существующего датасета сохраняем как есть, чтобы не терять данные старых
  // записей при пересохранении.
  const [kpiProfile] = useState<KpiProfile>(existingDataset?.kpiProfile ?? {});
  const [funnelSteps, setFunnelSteps] = useState<FunnelStep[]>(
    existingDataset?.funnelSteps ?? [],
  );
  const [saving, setSaving] = useState(false);

  const selectedSource = useMemo(
    () => sources.find((s) => s.id === dataSourceId),
    [sources, dataSourceId],
  );
  // Файловый источник (CSV/Excel/Google Sheets) — таблица всегда одна (FILE_TABLE),
  // и SQL к нему неприменим. Поэтому поля «Таблица» и «SQL-запрос» для таких
  // источников скрываем как лишние, а таблицу проставляем автоматически.
  const isFileSource = selectedSource?.kind === "file";
  useEffect(() => {
    if (isFileSource) {
      setUseSql(false);
      setTableName(FILE_TABLE);
    }
  }, [isFileSource]);

  const loadTables = useCallback(async () => {
    if (!dataSourceId) {
      setTables([]);
      setTablesState("idle");
      setTablesError(null);
      setTablesDiag(null);
      return;
    }
    const url = `/api/data-sources/${dataSourceId}/tables`;
    setTables([]);
    setTablesError(null);
    setTablesState("loading");
    setTablesDiag({
      sourceId: dataSourceId,
      url,
      status: null,
      durationMs: null,
    });
    const startedAt = performance.now();
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDemo: selectedSource?.isDemo ?? false }),
      });
      const durationMs = Math.round(performance.now() - startedAt);
      const body = (await r.json()) as {
        tables?: TableInfo[];
        error?: string;
        details?: string;
        step?: string;
      };
      if (!r.ok || body.error) {
        const message = body.error ?? `HTTP ${r.status}`;
        setTablesError({
          error: message,
          details: body.details,
          step: body.step,
        });
        setTablesState("error");
        setTablesDiag({
          sourceId: dataSourceId,
          url,
          status: r.status,
          durationMs,
          step: body.step,
          errorMessage: message,
        });
        toast({
          title: "Не удалось загрузить таблицы",
          description: message,
          variant: "destructive",
        });
        return;
      }
      const list = body.tables ?? [];
      setTables(list);
      setTablesState(list.length === 0 ? "empty" : "ready");
      setTablesDiag({
        sourceId: dataSourceId,
        url,
        status: r.status,
        durationMs,
      });
    } catch (e) {
      const durationMs = Math.round(performance.now() - startedAt);
      const message = e instanceof Error ? e.message : String(e);
      setTablesError({ error: message });
      setTablesState("error");
      setTablesDiag({
        sourceId: dataSourceId,
        url,
        status: null,
        durationMs,
        errorMessage: message,
      });
      toast({
        title: "Не удалось загрузить таблицы",
        description: message,
        variant: "destructive",
      });
    }
  }, [dataSourceId, selectedSource?.isDemo, toast]);

  useEffect(() => {
    void loadTables();
  }, [loadTables]);

  async function loadStructure(opts: { silent?: boolean } = {}) {
    if (!dataSourceId) return;
    if (!useSql && !tableName) {
      if (!opts.silent) {
        toast({ title: "Выберите таблицу", variant: "destructive" });
      }
      return;
    }
    setStructureLoading(true);
    try {
      const resp = await fetch(`/api/data-sources/${dataSourceId}/columns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isDemo: selectedSource?.isDemo ?? false,
          table: useSql ? null : tableName,
          sqlQuery: useSql ? sqlQuery : null,
        }),
      });
      const body = (await resp.json()) as {
        columns?: ColumnInfo[];
        preview?: QueryResultRow[];
        error?: string;
      };
      if (!resp.ok || body.error) {
        const raw = body.error ?? `HTTP ${resp.status}`;
        const normalized = normalizeClickhouseErrorMessage(raw);
        const needsFriendly =
          /Code:\s*\d+|ACCESS_DENIED|DB::Exception|ETIMEDOUT|ECONNREFUSED|aborted|Authentication failed|\b401\b|^\s*\{/i.test(
            normalized,
          );
        const description = needsFriendly
          ? friendlyClickhouseError(raw, {
              tableName: useSql ? undefined : tableName || undefined,
            })
          : raw;
        toast({
          title: "Ошибка загрузки структуры",
          description,
          variant: "destructive",
        });
        return;
      }
      if (body.columns) {
        const existingByName = new Map(
          columns.map((c) => [c.name, c] as const),
        );
        const next: DatasetColumn[] = body.columns.map((c) => {
          const prev = existingByName.get(c.name);
          return (
            prev ?? {
              name: c.name,
              clickhouseType: c.type,
              datasetType: mapClickhouseType(c.type),
              description: "",
              businessContext: "",
              enabled: true,
              isAutoDetected: true,
            }
          );
        });
        setColumns(next);
      }
      if (body.preview) setPreview(body.preview);
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setStructureLoading(false);
    }
  }

  // Авто-загрузка превью при открытии существующего датасета: если у нас
  // уже сохранены столбцы и есть таблица/SQL — сразу подтягиваем 100 строк,
  // чтобы пользователь не жал «Загрузить структуру» вручную.
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (autoLoadedRef.current) return;
    if (!existingDataset) return;
    if (!dataSourceId || !selectedSource) return;
    if (preview.length > 0) return;
    const hasSource = useSql ? !!sqlQuery : !!tableName;
    if (!hasSource) return;
    autoLoadedRef.current = true;
    void loadStructure({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingDataset?.id, dataSourceId, selectedSource?.id]);

  async function onSave() {
    if (!name.trim()) {
      toast({ title: "Введите название датасета", variant: "destructive" });
      return;
    }
    if (!dataSourceId) {
      toast({ title: "Выберите источник", variant: "destructive" });
      return;
    }
    if (columns.length === 0) {
      toast({
        title: "Сначала загрузите структуру данных",
        variant: "destructive",
      });
      return;
    }
    const columnNames = columns.map((c) => c.name);
    for (const cf of calculatedFields) {
      if (!cf.name.trim()) {
        toast({
          title: "Вычисляемое поле без названия",
          variant: "destructive",
        });
        return;
      }
      const check = validateFormula(cf.formula, columnNames);
      if (!check.ok) {
        toast({
          title: `Ошибка в формуле "${cf.name}"`,
          description: check.error,
          variant: "destructive",
        });
        return;
      }
    }
    const columnsForSave: DatasetColumn[] = columns.map((c) => {
      const ctx = (c.businessContext ?? "").trim();
      return {
        ...c,
        businessContext: ctx,
        aiDescription: ctx || undefined,
      };
    });
    const payload: Omit<Dataset, "id"> = {
      name: name.trim(),
      dataSourceId,
      table: useSql ? null : tableName,
      sqlQuery: useSql ? sqlQuery : null,
      columns: columnsForSave,
      createdAt: existingDataset?.createdAt ?? new Date().toISOString(),
      rowCount: existingDataset?.rowCount,
      calculatedFields,
      businessContext: businessContext.trim(),
      kpiProfile,
      funnelSteps: funnelSteps.length > 0 ? funnelSteps : undefined,
    };
    setSaving(true);
    const mode = existingDataset ? "update" : "create";
    console.log(`[datasets-save] begin mode=${mode} name=${payload.name}`);
    console.log("[datasets-save] payload", {
      ...payload,
      columnsCount: payload.columns.length,
      calculatedFieldsCount: payload.calculatedFields.length,
    });
    try {
      if (existingDataset) {
        const updated = await updateDataset(existingDataset.id, payload);
        console.log("[datasets-save] success mode=update id=" + updated.id);
        toast({ title: "Датасет сохранён", variant: "success" });
      } else {
        const created = await addDataset(payload);
        console.log("[datasets-save] success mode=create id=" + created.id);
        if (user) {
          void logAudit(
            getSupabaseBrowserClient(),
            user.id,
            "dataset_created",
            "dataset",
            created.id,
            { name: created.name },
          );
        }
        toast({ title: "Датасет сохранён", variant: "success" });
      }
      router.push("/datasets");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[datasets-save] error mode=${mode} message=${message}`, e);
      toast({
        title: "Ошибка сохранения датасета",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageContainer
      icon={<LayoutGrid className="h-5 w-5" />}
      title={existingDataset ? "Редактирование датасета" : "Новый датасет"}
      description="Настройте источник, выберите таблицу и типы столбцов."
      actions={
        <>
          <Button asChild variant="ghost">
            <Link href="/datasets">
              <ArrowLeft />
              Назад
            </Link>
          </Button>
          {columns.length > 0 && (
            <Button
              type="button"
              variant="outline"
              className="border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
              onClick={() => {
                const el = document.getElementById("calc-fields");
                if (!el) return;
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                el.classList.add("ring-2", "ring-primary/60");
                setTimeout(() => {
                  el.classList.remove("ring-2", "ring-primary/60");
                }, 1800);
              }}
              title="Перейти к столбцам и вычисляемым полям"
            >
              <Calculator />
              Формулы
            </Button>
          )}
          <Button variant="gradient" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {saving ? "Сохраняю..." : "Сохранить"}
          </Button>
        </>
      }
    >
      <div className="space-y-5 pb-[42vh]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground">
              Название
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="Например: Установки по каналам"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-base"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground">
              Шаг 1 · Источник данных
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Источник данных</Label>
                <Select value={dataSourceId} onValueChange={setDataSourceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите источник" />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!useSql && !isFileSource && (
                <div className="space-y-2">
                  <Label>Таблица</Label>
                  {tablesState === "loading" ? (
                    <div className="relative">
                      <div className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
                        Загружаю таблицы…
                      </div>
                    </div>
                  ) : (
                    <Select
                      value={tableName ?? ""}
                      onValueChange={setTableName}
                      disabled={
                        tablesState === "idle" ||
                        tablesState === "error" ||
                        tablesState === "empty"
                      }
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            tablesState === "idle"
                              ? "Сначала выберите источник"
                              : tablesState === "error"
                                ? "Ошибка загрузки таблиц"
                                : tablesState === "empty"
                                  ? "В этой БД нет доступных таблиц"
                                  : "Выберите таблицу"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {tables.length > 20 && (
                          <div className="p-2">
                            <Input
                              placeholder="Поиск таблицы…"
                              value={tableSearch}
                              onChange={(e) => setTableSearch(e.target.value)}
                              onKeyDown={(e) => e.stopPropagation()}
                              className="h-8"
                            />
                          </div>
                        )}
                        {tables
                          .filter((t) =>
                            tableSearch.trim() === ""
                              ? true
                              : t.name
                                  .toLowerCase()
                                  .includes(tableSearch.trim().toLowerCase()),
                          )
                          .map((t) => (
                            <SelectItem key={t.name} value={t.name}>
                              {t.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                  {tablesState === "error" && tablesError && (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="font-medium">{tablesError.error}</div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => void loadTables()}
                        >
                          <RefreshCw className="h-3 w-3" />
                          Повторить
                        </Button>
                      </div>
                    </div>
                  )}
                  {tablesState === "empty" && (
                    <p className="text-xs text-muted-foreground">
                      В этой БД нет доступных таблиц
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Диагностика — только когда таблицы источника не загрузились. */}
            {dataSourceId && tablesDiag?.errorMessage && (
              <div className="rounded-md border border-border bg-muted/10">
                <button
                  type="button"
                  onClick={() => setDiagOpen((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  {diagOpen ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  <Info className="h-3 w-3" />
                  <span>Диагностика загрузки таблиц</span>
                  {tablesDiag?.status !== null &&
                    tablesDiag?.status !== undefined && (
                      <span
                        className={`ml-auto font-mono ${
                          tablesState === "error"
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {tablesDiag.status} · {tablesDiag.durationMs ?? 0} мс
                      </span>
                    )}
                </button>
                {diagOpen && (
                  <div className="space-y-1 border-t border-border px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    <div>
                      <span className="text-foreground/70">source.id:</span>{" "}
                      {tablesDiag?.sourceId ?? dataSourceId}
                    </div>
                    <div className="break-all">
                      <span className="text-foreground/70">request:</span> POST{" "}
                      {tablesDiag?.url ??
                        `/api/data-sources/${dataSourceId}/tables`}
                    </div>
                    <div>
                      <span className="text-foreground/70">status:</span>{" "}
                      {tablesDiag?.status ?? (tablesState === "loading" ? "…" : "—")}
                    </div>
                    <div>
                      <span className="text-foreground/70">duration:</span>{" "}
                      {tablesDiag?.durationMs !== null &&
                      tablesDiag?.durationMs !== undefined
                        ? `${tablesDiag.durationMs} ms`
                        : tablesState === "loading"
                          ? "…"
                          : "—"}
                    </div>
                    <div>
                      <span className="text-foreground/70">state:</span>{" "}
                      {tablesState}
                    </div>
                    {tablesDiag?.step && (
                      <div>
                        <span className="text-foreground/70">step:</span>{" "}
                        <span className="text-destructive">
                          {tablesDiag.step}
                        </span>
                      </div>
                    )}
                    {tablesError?.details && (
                      <div className="break-all">
                        <span className="text-foreground/70">details:</span>{" "}
                        <span className="text-destructive/80">
                          {tablesError.details}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!isFileSource && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 p-3">
                <div>
                  <Label htmlFor="use-sql" className="cursor-pointer">
                    Использовать SQL-запрос
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Вместо готовой таблицы — пишите произвольный SELECT
                  </p>
                </div>
                <Switch
                  id="use-sql"
                  checked={useSql}
                  onCheckedChange={setUseSql}
                />
              </div>
            )}

            {useSql && (
              <div className="space-y-2">
                <Label>SQL-запрос</Label>
                <Textarea
                  placeholder="SELECT * FROM campaigns WHERE date >= today() - 30"
                  value={sqlQuery}
                  onChange={(e) => setSqlQuery(e.target.value)}
                  className="font-mono text-xs min-h-[120px]"
                />
              </div>
            )}

            <div className="space-y-1.5 pt-1">
              <Button
                variant="gradient"
                onClick={() => loadStructure()}
                disabled={structureLoading}
                className="h-11 w-full text-sm font-medium"
              >
                {structureLoading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Download />
                )}
                {columns.length > 0
                  ? "Обновить структуру таблицы"
                  : "Загрузить структуру таблицы"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Подтянет колонки и их типы из источника — это первый шаг перед
                настройкой датасета.
              </p>
            </div>
          </CardContent>
        </Card>

        {columns.length > 0 && (
          <Card id="calc-fields">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground">
                Шаг 2 · Столбцы и поля (
                {columns.filter((c) => c.enabled).length} из {columns.length}
                {calculatedFields.length > 0
                  ? ` · ${calculatedFields.length} fx`
                  : ""}
                )
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InlineHelp title="Как это работает: столбцы, типы и вычисляемые поля">
                <p>
                  <b className="text-foreground">Тип столбца</b> говорит платформе,
                  как с ним работать: <b className="text-foreground">«число»</b>{" "}
                  (расход, клики, выручка) — попадает в метрики и расчёты;{" "}
                  <b className="text-foreground">«дата»</b> — для трендов и фильтра
                  по периоду; <b className="text-foreground">«категория/текст»</b>{" "}
                  (кампания, гео, источник) — для группировки.
                </p>
                <p>
                  Если тип определился неверно (например, число распозналось как
                  текст) — поправьте его здесь, иначе оно не будет считаться.
                </p>
                <p>
                  <b className="text-foreground">Вычисляемые поля (fx)</b> — ваши
                  метрики из формул (ARPU, ROI, CPI). Для долей и ставок делите{" "}
                  <b className="text-foreground">сумму на сумму</b> (например{" "}
                  <code className="font-mono">SUM([revenue_rub]) / SUM([installs])</code>),
                  а не строку на строку — иначе при группировке цифры «поедут».
                </p>
              </InlineHelp>
              <ColumnConfigurator
                columns={columns}
                onChange={setColumns}
                calculatedFields={calculatedFields}
                onCalculatedFieldsChange={setCalculatedFields}
              />
            </CardContent>
          </Card>
        )}

        {columns.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground">
                Шаг 3 · Контекст для AI
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InlineHelp title="Как это работает: контекст для AI">
                <p>
                  Контекст — это подсказки для AI: что за бизнес, что значат
                  столбцы и какие у вас KPI. Чем точнее опишете (например,
                  «<b className="text-foreground">revenue</b> — выручка в USD»,
                  «целевой ROAS — 120%»), тем релевантнее выводы и рекомендации.
                </p>
                <p>
                  Это <b className="text-foreground">не обязательно</b>, но заметно
                  повышает качество анализа. В модель уходит как пояснение —{" "}
                  <b className="text-foreground">без ваших строк с данными</b>.
                </p>
              </InlineHelp>
              <AiContextEditor
                businessContext={businessContext}
                onBusinessContextChange={setBusinessContext}
                columns={columns}
                onColumnsChange={setColumns}
                calculatedFields={calculatedFields}
                onCalculatedFieldsChange={setCalculatedFields}
                funnelSteps={funnelSteps}
                onFunnelStepsChange={setFunnelSteps}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {columns.length > 0 && (useSql ? !!sqlQuery : !!tableName) && (
        <DatasetPreviewPanel
          dataSourceId={dataSourceId}
          table={useSql ? null : tableName}
          sqlQuery={useSql ? sqlQuery : null}
          isDemo={selectedSource?.isDemo ?? false}
          calculatedFields={calculatedFields}
          columns={columns}
        />
      )}
    </PageContainer>
  );
}

