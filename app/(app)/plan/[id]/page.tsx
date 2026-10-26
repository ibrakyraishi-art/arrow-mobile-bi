"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Info,
  LayoutDashboard,
  Pencil,
  Plus,
  Settings2,
  Target,
  Trash2,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { LoadingState } from "@/components/layout/LoadingState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { DEMO_PLAN_READONLY_MESSAGE, usePlanStore } from "@/stores/planStore";
import { useDatasetStore } from "@/stores/datasetStore";
import { useDashboardStore } from "@/stores/dashboardStore";
import { moscowMonth } from "@/lib/plan";
import { DEMO_PLAN_DASHBOARD_ID } from "@/lib/demo-data";
import type { PlanField } from "@/lib/types";
import { PlanSteps, type PlanStep } from "@/components/plan/PlanSteps";
import { PlanGrid } from "@/components/plan/PlanGrid";
import { PlanReport } from "@/components/plan/PlanReport";
import { PlanFieldDialog } from "@/components/plan/PlanFieldDialog";
import { PlanProjectDialog } from "@/components/plan/PlanProjectDialog";
import { BuildDashboardDialog } from "@/components/plan/BuildDashboardDialog";
import { ConfirmDialog } from "@/components/plan/ConfirmDialog";
import { findPlanDashboard } from "@/components/plan/build-dashboard";
import { usePlanSummary } from "@/components/plan/summary";
import {
  DIRECTION_LABEL,
  KIND_LABEL,
  datasetName,
  errorText,
  useEnsurePlanLoaded,
} from "@/components/plan/plan-ui";

export default function PlanProjectPage() {
  useEnsurePlanLoaded();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const router = useRouter();
  const { toast } = useToast();

  const project = usePlanStore((s) => s.projects.find((p) => p.id === id));
  const loaded = usePlanStore((s) => s.loaded);
  const loading = usePlanStore((s) => s.loading);
  const storeError = usePlanStore((s) => s.error);
  const reload = usePlanStore((s) => s.reload);
  const deleteProject = usePlanStore((s) => s.deleteProject);
  const deleteField = usePlanStore((s) => s.deleteField);
  const datasets = useDatasetStore((s) => s.datasets);
  const dashboards = useDashboardStore((s) => s.dashboards);

  const currentMonth = useMemo(() => moscowMonth(new Date()), []);
  const [reportMonth, setReportMonth] = useState(currentMonth);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [fieldDialog, setFieldDialog] = useState<{ open: boolean; field?: PlanField }>({
    open: false,
  });
  const [fieldToDelete, setFieldToDelete] = useState<PlanField | null>(null);

  // Отчёт перезапрашивается после правок плана (с задержкой — чтобы серия
  // правок в сетке дала один запрос) и после изменения полей.
  const [valuesTick, setValuesTick] = useState(0);
  const tickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onValueSaved = useCallback(() => {
    if (tickTimer.current) clearTimeout(tickTimer.current);
    tickTimer.current = setTimeout(() => setValuesTick((t) => t + 1), 800);
  }, []);
  useEffect(
    () => () => {
      if (tickTimer.current) clearTimeout(tickTimer.current);
    },
    [],
  );
  const fieldsKey = project?.fields
    .map((f) => `${f.id}:${f.label}:${f.sourceColumn}:${f.kind}:${f.direction}`)
    .join("|");
  const summary = usePlanSummary(
    project && project.fields.length > 0 ? project.id : null,
    reportMonth,
    `${fieldsKey}#${valuesTick}#${project?.datasetId}:${project?.dateColumn}`,
  );

  const dataset = project ? datasets.find((d) => d.id === project.datasetId) : undefined;
  const isDemo = Boolean(project?.isDemo);
  const builtDashboard = useMemo(() => {
    if (!project) return undefined;
    if (isDemo) {
      return dashboards.find((d) => d.id === DEMO_PLAN_DASHBOARD_ID);
    }
    return findPlanDashboard(project, dashboards);
  }, [project, isDemo, dashboards]);

  if (!project) {
    // PageContainer — чтобы лоадер занимал всю ширину контента, а не сжимался
    // в левую колонку flex-обёртки <main>.
    if (!loaded || loading)
      return (
        <PageContainer icon={<Target className="h-5 w-5" />} title="План-проект">
          <LoadingState label="Загружаем план-проект…" />
        </PageContainer>
      );
    if (storeError)
      return (
        <PageContainer icon={<Target className="h-5 w-5" />} title="План-проект не загрузился">
          <p className="mb-4 text-sm text-muted-foreground">{storeError}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void reload()}>
              Повторить
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/plan">
                <ArrowLeft />
                Все план-проекты
              </Link>
            </Button>
          </div>
        </PageContainer>
      );
    return (
      <PageContainer icon={<Target className="h-5 w-5" />} title="План-проект не найден">
        <p className="mb-4 text-sm text-muted-foreground">
          Проект удалён или ссылка неверная.
        </p>
        <Button variant="outline" asChild>
          <Link href="/plan">
            <ArrowLeft />
            Все план-проекты
          </Link>
        </Button>
      </PageContainer>
    );
  }

  const fields = [...project.fields].sort((a, b) => a.sortOrder - b.sortOrder);
  const hasPlanThisMonth = fields.some((f) => project.values[f.id]?.[currentMonth] !== undefined);
  const steps: PlanStep[] = [
    { key: "dataset", title: "Датасет", hint: datasetName(datasets, project.datasetId), done: Boolean(project.datasetId) },
    { key: "date", title: "Дата", hint: project.dateColumn || "колонка даты", done: Boolean(project.dateColumn) },
    {
      key: "fields",
      title: "Поля",
      hint: fields.length > 0 ? `${fields.length} в плане` : "добавьте метрики",
      done: fields.length > 0,
    },
    {
      key: "plan",
      title: "План",
      hint: hasPlanThisMonth ? "вписан на текущий месяц" : "впишите план на месяц",
      done: hasPlanThisMonth,
    },
    {
      key: "dashboard",
      title: "Дашборд",
      hint: builtDashboard ? "собран" : "соберите в один клик",
      done: Boolean(builtDashboard),
    },
  ];

  async function handleDeleteProject() {
    if (!project) return false;
    try {
      await deleteProject(project.id);
      toast({ title: "План-проект удалён" });
      router.push("/plan");
      return true;
    } catch (e) {
      toast({ title: "Не удалось удалить", description: errorText(e), variant: "destructive" });
      return false;
    }
  }

  async function handleDeleteField() {
    if (!fieldToDelete) return true;
    try {
      await deleteField(fieldToDelete.id);
      toast({ title: `Поле «${fieldToDelete.label}» удалено` });
      return true;
    } catch (e) {
      toast({ title: "Не удалось удалить поле", description: errorText(e), variant: "destructive" });
      return false;
    }
  }

  const actions = isDemo ? (
    <>
      {builtDashboard && (
        <Button variant="outline" asChild>
          <Link href={`/dashboards/${builtDashboard.id}`}>
            <LayoutDashboard />
            Демо-дашборд
          </Link>
        </Button>
      )}
      <Button variant="gradient" onClick={() => setCreateOpen(true)}>
        <Plus />
        Создать свой проект
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} title="Настройки проекта" aria-label="Настройки проекта">
        <Settings2 />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => setDeleteOpen(true)} title="Удалить проект" aria-label="Удалить проект">
        <Trash2 />
      </Button>
      <Button variant="gradient" onClick={() => setBuildOpen(true)} disabled={fields.length === 0}>
        <LayoutDashboard />
        Собрать дашборд план/факт
      </Button>
    </>
  );

  return (
    <PageContainer
      icon={<Target className="h-5 w-5" />}
      title={project.name}
      description={`Датасет: ${datasetName(datasets, project.datasetId)} · колонка даты: ${project.dateColumn}`}
      actions={actions}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs">
        <Link href="/plan" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Все план-проекты
        </Link>
        <Link href="/help#plan" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Как построить план/факт — статья в помощи
        </Link>
      </div>

      {isDemo && (
        <div className="mb-4 flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <div className="font-medium text-foreground">Это демо — создайте свой проект</div>
            <div className="text-muted-foreground">
              {DEMO_PLAN_READONLY_MESSAGE} Здесь видно, как всё работает: поля, план по месяцам и
              отчёт текущего месяца.
            </div>
          </div>
        </div>
      )}

      <div className="space-y-8">
        <PlanSteps steps={steps} />

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Отчёт</h2>
          <PlanReport
            month={reportMonth}
            onMonthChange={setReportMonth}
            summary={summary}
            hasFields={fields.length > 0}
          />
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Поля плана</h2>
            {!isDemo && (
              <Button size="sm" onClick={() => setFieldDialog({ open: true })}>
                <Plus />
                Добавить поле
              </Button>
            )}
          </div>
          {fields.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Полей пока нет. Добавьте метрику датасета — например, расход, установки или CPI.
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              {fields.map((f) => (
                <div
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{f.label}</div>
                    <div className="text-xs text-muted-foreground">метрика: {f.sourceColumn}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{KIND_LABEL[f.kind]}</Badge>
                    <Badge variant="outline">{DIRECTION_LABEL[f.direction]}</Badge>
                    {!isDemo && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setFieldDialog({ open: true, field: f })}
                          aria-label={`Изменить поле ${f.label}`}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setFieldToDelete(f)}
                          aria-label={`Удалить поле ${f.label}`}
                        >
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">План по месяцам</h2>
          <PlanGrid
            project={project}
            currentMonth={currentMonth}
            readOnly={isDemo}
            onSaved={onValueSaved}
          />
        </section>
      </div>

      {isDemo && (
        <PlanProjectDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSaved={(p) => router.push(`/plan/${p.id}`)}
        />
      )}
      {!isDemo && (
        <>
          <PlanProjectDialog open={settingsOpen} onOpenChange={setSettingsOpen} project={project} />
          <PlanFieldDialog
            open={fieldDialog.open}
            onOpenChange={(open) => setFieldDialog((s) => ({ ...s, open }))}
            project={project}
            dataset={dataset}
            field={fieldDialog.field}
          />
          <BuildDashboardDialog
            open={buildOpen}
            onOpenChange={setBuildOpen}
            project={project}
            dataset={dataset}
          />
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title={`Удалить план-проект «${project.name}»?`}
            description="Удалятся поля и все плановые значения. Это увидит вся команда. Собранные дашборды останутся."
            onConfirm={handleDeleteProject}
          />
          <ConfirmDialog
            open={fieldToDelete !== null}
            onOpenChange={(open) => !open && setFieldToDelete(null)}
            title={`Удалить поле «${fieldToDelete?.label ?? ""}»?`}
            description="Удалится и план этого поля по всем месяцам."
            onConfirm={handleDeleteField}
          />
        </>
      )}
    </PageContainer>
  );
}
