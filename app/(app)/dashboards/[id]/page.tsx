"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  LayoutDashboard,
  Plus,
  Settings2,
  Pencil,
  Check,
  Loader2,
  X,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/layout/LoadingState";
import { useToast } from "@/components/ui/use-toast";
import { GlobalFilters } from "@/components/dashboards/GlobalFilters";
import { ConfigureFiltersDialog } from "@/components/dashboards/ConfigureFiltersDialog";
import { AddWidgetDialog } from "@/components/dashboards/AddWidgetDialog";
import { DashboardWidgetCard } from "@/components/dashboards/DashboardWidget";
import { useDashboardStore } from "@/stores/dashboardStore";
import { useDatasetStore } from "@/stores/datasetStore";
import { useDataSourceStore } from "@/stores/dataSourceStore";
import { useVisualizationStore } from "@/stores/visualizationStore";
import { isDemoObjectId } from "@/lib/demo-data";
import { buildGlobalFilterConditions } from "@/lib/dashboard-filters";
import { cn } from "@/lib/utils";
import type { DashboardSheet, DashboardWidget, DashboardWidgetWidth } from "@/lib/types";

export default function DashboardDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const dashboardsLoaded = useDashboardStore((s) => s.loaded);
  const currentDashboard = useDashboardStore((s) => s.currentDashboard);
  const activeFilters = useDashboardStore((s) => s.activeFilters);
  const loadDashboard = useDashboardStore((s) => s.loadDashboard);
  const updateDashboard = useDashboardStore((s) => s.updateDashboard);
  const createSheet = useDashboardStore((s) => s.createSheet);
  const updateSheet = useDashboardStore((s) => s.updateSheet);
  const deleteSheet = useDashboardStore((s) => s.deleteSheet);
  const createWidget = useDashboardStore((s) => s.createWidget);
  const updateWidget = useDashboardStore((s) => s.updateWidget);
  const deleteWidget = useDashboardStore((s) => s.deleteWidget);
  const setFilterValue = useDashboardStore((s) => s.setFilterValue);
  const resetFilters = useDashboardStore((s) => s.resetFilters);

  const datasetsLoaded = useDatasetStore((s) => s.loaded);
  const getDataset = useDatasetStore((s) => s.getDataset);
  const getSource = useDataSourceStore((s) => s.getSource);
  const visualizations = useVisualizationStore((s) => s.visualizations);

  const [localLoading, setLocalLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addWidgetOpen, setAddWidgetOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<DashboardWidget | null>(
    null,
  );
  const [renamingSheetId, setRenamingSheetId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLocalLoading(true);
      try {
        const d = await loadDashboard(params.id);
        if (!cancelled && d) {
          setActiveSheetId(d.sheets[0]?.id ?? null);
          setNameDraft(d.name);
        }
      } finally {
        if (!cancelled) setLocalLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [params.id, loadDashboard]);

  const dashboard = currentDashboard;
  const dataset = dashboard ? getDataset(dashboard.datasetId) : undefined;
  const source = dataset ? getSource(dataset.dataSourceId) : undefined;

  const activeSheet: DashboardSheet | undefined = useMemo(() => {
    if (!dashboard) return undefined;
    return (
      dashboard.sheets.find((s) => s.id === activeSheetId) ?? dashboard.sheets[0]
    );
  }, [dashboard, activeSheetId]);

  const globalFilterConditions = useMemo(
    () =>
      dashboard
        ? buildGlobalFilterConditions(dashboard.filtersConfig, activeFilters)
        : [],
    [dashboard, activeFilters],
  );

  const vizById = useMemo(() => {
    const map = new Map<string, (typeof visualizations)[number]>();
    for (const v of visualizations) map.set(v.id, v);
    return map;
  }, [visualizations]);

  if (localLoading || !dashboardsLoaded || !datasetsLoaded) {
    return (
      <PageContainer
        icon={<LayoutDashboard className="h-5 w-5" />}
        title="Дашборд"
      >
        <LoadingState label="Загружаем дашборд…" />
      </PageContainer>
    );
  }

  if (!dashboard) {
    return (
      <PageContainer
        icon={<LayoutDashboard className="h-5 w-5" />}
        title="Дашборд не найден"
      >
        <Button asChild variant="outline">
          <Link href="/dashboards">
            <ArrowLeft />
            К списку
          </Link>
        </Button>
      </PageContainer>
    );
  }

  if (!dataset || !source) {
    return (
      <PageContainer
        icon={<LayoutDashboard className="h-5 w-5" />}
        title={dashboard.name}
      >
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Датасет или источник не найдены. Возможно, они были удалены.
        </div>
      </PageContainer>
    );
  }

  async function handleSaveName() {
    if (!dashboard) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === dashboard.name) {
      setEditingName(false);
      setNameDraft(dashboard.name);
      return;
    }
    try {
      await updateDashboard(dashboard.id, { name: trimmed });
      setEditingName(false);
    } catch (e) {
      toast({
        title: "Ошибка сохранения",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function handleAddSheet() {
    if (!dashboard) return;
    try {
      const n = dashboard.sheets.length + 1;
      const sheet = await createSheet(dashboard.id, `Лист ${n}`);
      setActiveSheetId(sheet.id);
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function handleRenameSheet(sheetId: string) {
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      setRenamingSheetId(null);
      return;
    }
    try {
      await updateSheet(sheetId, { name: trimmed });
      setRenamingSheetId(null);
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function handleDeleteSheet(sheetId: string) {
    if (!dashboard) return;
    if (dashboard.sheets.length <= 1) {
      toast({ title: "Нельзя удалить последний лист", variant: "destructive" });
      return;
    }
    if (!confirm("Удалить лист со всеми виджетами?")) return;
    try {
      await deleteSheet(sheetId);
      if (activeSheetId === sheetId) {
        const remaining = dashboard.sheets.filter((s) => s.id !== sheetId);
        setActiveSheetId(remaining[0]?.id ?? null);
      }
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function handleAddOrUpdateWidget(
    widget: Omit<DashboardWidget, "id" | "sheetId">,
  ) {
    if (!activeSheet) return;
    try {
      if (editingWidget) {
        await updateWidget(editingWidget.id, widget);
        toast({ title: "Виджет обновлён", variant: "success" });
      } else {
        await createWidget(activeSheet.id, widget);
        toast({ title: "Виджет добавлен", variant: "success" });
      }
      setEditingWidget(null);
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function handleWidthChange(
    widgetId: string,
    width: DashboardWidgetWidth,
  ) {
    try {
      await updateWidget(widgetId, { width });
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function handleDeleteWidget(widgetId: string) {
    if (!confirm("Удалить виджет?")) return;
    try {
      await deleteWidget(widgetId);
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function handleSaveFilters(
    filters: import("@/lib/types").DashboardFilter[],
  ) {
    if (!dashboard) return;
    try {
      await updateDashboard(dashboard.id, { filtersConfig: filters });
      toast({ title: "Фильтры сохранены", variant: "success" });
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  const sheetWidgets = activeSheet
    ? activeSheet.widgets.slice().sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  return (
    <PageContainer
      icon={<LayoutDashboard className="h-5 w-5" />}
      title=""
      actions={
        <>
          <Button asChild variant="ghost">
            <Link href="/dashboards">
              <ArrowLeft />К списку
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => setFiltersOpen(true)}
          >
            <Settings2 />
            Настроить фильтры
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setEditingWidget(null);
              setAddWidgetOpen(true);
            }}
            disabled={!activeSheet}
          >
            <Plus />
            Добавить виджет
          </Button>
          <Button
            variant={editing ? "gradient" : "outline"}
            onClick={() => setEditing((v) => !v)}
          >
            <Pencil />
            {editing ? "Готово" : "Редактировать"}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-center gap-3">
        {editingName ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSaveName();
                if (e.key === "Escape") {
                  setEditingName(false);
                  setNameDraft(dashboard.name);
                }
              }}
              className="h-9 max-w-md text-xl font-semibold"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSaveName}
              className="h-8 w-8"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setEditingName(false);
                setNameDraft(dashboard.name);
              }}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            className="group flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-accent/40"
          >
            <h1 className="text-2xl font-semibold tracking-tight">
              {dashboard.name}
            </h1>
            <Pencil className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
          </button>
        )}
        <span className="text-sm text-muted-foreground">· {dataset.name}</span>
      </div>

      {/* Global filters */}
      <div className="mb-4">
        <GlobalFilters
          filters={dashboard.filtersConfig}
          activeFilters={activeFilters}
          dataset={dataset}
          source={source}
          onChange={setFilterValue}
          onReset={resetFilters}
        />
      </div>

      {/* Widgets area */}
      <div className="flex flex-wrap gap-4">
        {sheetWidgets.length === 0 ? (
          <div className="flex min-h-[240px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/30 p-8 text-center">
            <p className="text-sm font-medium">Нет виджетов на этом листе</p>
            <p className="text-xs text-muted-foreground">
              Нажмите «Добавить виджет», чтобы разместить график, сводную
              таблицу, метрику или текст.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingWidget(null);
                setAddWidgetOpen(true);
              }}
              className="mt-2"
            >
              <Plus className="h-3.5 w-3.5" />
              Добавить виджет
            </Button>
          </div>
        ) : (
          sheetWidgets.map((w) => (
            <DashboardWidgetCard
              key={w.id}
              widget={w}
              dataset={dataset}
              source={source}
              visualization={
                w.visualizationId ? vizById.get(w.visualizationId) : undefined
              }
              globalFilters={globalFilterConditions}
              editing={editing}
              onEdit={() => {
                if (w.widgetType === "metric" || w.widgetType === "text") {
                  setEditingWidget(w);
                  setAddWidgetOpen(true);
                } else if (
                  w.visualizationId &&
                  !w.visualizationId.startsWith("demo-")
                ) {
                  router.push(`/visualization/${w.visualizationId}`);
                } else {
                  setEditingWidget(w);
                  setAddWidgetOpen(true);
                }
              }}
              onDelete={() => void handleDeleteWidget(w.id)}
              onChangeWidth={(width) => void handleWidthChange(w.id, width)}
            />
          ))
        )}
      </div>

      {/* Sheet tabs */}
      <div className="mt-6 flex items-center gap-1 border-t border-border pt-2 overflow-x-auto">
        {dashboard.sheets.map((s) => (
          <div
            key={s.id}
            className={cn(
              "group flex items-center gap-1 rounded-t-md border border-b-0 px-3 py-1.5 text-xs",
              activeSheetId === s.id
                ? "border-border bg-card text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent/40",
            )}
          >
            {renamingSheetId === s.id ? (
              <Input
                autoFocus
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => void handleRenameSheet(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleRenameSheet(s.id);
                  if (e.key === "Escape") setRenamingSheetId(null);
                }}
                className="h-6 w-[120px] text-xs"
              />
            ) : (
              <button
                type="button"
                onClick={() => setActiveSheetId(s.id)}
                onDoubleClick={() => {
                  setRenamingSheetId(s.id);
                  setRenameDraft(s.name);
                }}
                className="font-medium"
              >
                {s.name}
              </button>
            )}
            {activeSheetId === s.id && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="ml-0.5 flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    title="Действия с листом"
                  >
                    <MoreHorizontal className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuItem
                    onClick={() => {
                      setRenamingSheetId(s.id);
                      setRenameDraft(s.name);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Переименовать
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => void handleDeleteSheet(s.id)}
                    className="text-destructive focus:text-destructive"
                    disabled={dashboard.sheets.length <= 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Удалить лист
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={handleAddSheet}
          className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          title="Добавить лист"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <ConfigureFiltersDialog
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        dataset={dataset}
        filters={dashboard.filtersConfig}
        onSave={handleSaveFilters}
      />
      <AddWidgetDialog
        open={addWidgetOpen}
        onOpenChange={(open) => {
          setAddWidgetOpen(open);
          if (!open) setEditingWidget(null);
        }}
        dataset={dataset}
        demoDashboard={isDemoObjectId(params.id)}
        editingWidget={editingWidget}
        onAdd={handleAddOrUpdateWidget}
      />

      {editing && (
        <div className="pointer-events-none fixed bottom-4 right-4 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary shadow-lg">
          <Loader2 className="h-3.5 w-3.5 animate-pulse" />
          Режим редактирования
        </div>
      )}
    </PageContainer>
  );
}
