"use client";

import { buildPlanDashboard, planDashboardName, planDashboardTarget } from "@/lib/plan";
import { DEMO_SAVE_HINT } from "@/lib/demo-data";
import type { Dashboard, Dataset, PlanProject } from "@/lib/types";
import { useDashboardStore } from "@/stores/dashboardStore";
import { useVisualizationStore } from "@/stores/visualizationStore";

/**
 * localStorage-ключ «собранного дашборда»: `{ [planProjectId]: dashboardId }`.
 * Префикс `ai-gomobile.` — как у остальных ключей приложения.
 */
export const PLAN_DASHBOARDS_STORAGE_KEY = "ai-gomobile.planDashboards";

function readMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PLAN_DASHBOARDS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch (e) {
    console.warn("[plan] не прочитать ключ собранных дашбордов", e);
    return {};
  }
}

export function rememberPlanDashboard(projectId: string, dashboardId: string): void {
  try {
    const map = readMap();
    map[projectId] = dashboardId;
    window.localStorage.setItem(PLAN_DASHBOARDS_STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    // Приватный режим / переполнено — дашборд создан, просто не запомним его.
    console.warn("[plan] не записать ключ собранных дашбордов", e);
  }
}

/**
 * Уже собранный дашборд проекта: id из localStorage, если дашборд ещё есть;
 * иначе — дашборд с именем шаблона на том же датасете (собран в другом браузере).
 */
export function findPlanDashboard(
  project: Pick<PlanProject, "id" | "name" | "datasetId">,
  dashboards: Dashboard[],
): Dashboard | undefined {
  const storedId = readMap()[project.id];
  const byId = storedId ? dashboards.find((d) => d.id === storedId) : undefined;
  if (byId) return byId;
  const templateName = planDashboardName(project);
  return dashboards.find((d) => d.datasetId === project.datasetId && d.name === templateName);
}

/**
 * Сохраняет черновик `buildPlanDashboard` через существующие сторы:
 * визуализации → дашборд (+ фильтр «Период») → листы → виджеты с заменой
 * временных id. При ошибке на полпути удаляет уже созданное.
 */
export async function savePlanDashboard(
  project: PlanProject,
  dataset: Dataset,
  opts: { breakdownColumn?: string | string[]; name?: string } = {},
): Promise<Dashboard> {
  if (planDashboardTarget(project).kind === "demo") {
    // Без этой проверки БД отвечает сырой ошибкой uuid на id демо-датасета.
    throw new Error(DEMO_SAVE_HINT);
  }
  const draft = buildPlanDashboard(project, dataset, {
    breakdownColumn: opts.breakdownColumn,
    name: opts.name,
  });
  const vizStore = useVisualizationStore.getState();
  const dashStore = useDashboardStore.getState();

  const vizIds = new Map<string, string>();
  let dashboardId: string | null = null;
  try {
    for (const v of draft.visualizations) {
      const created = await vizStore.addVisualization({
        name: v.name,
        datasetId: v.datasetId,
        type: v.type,
        config: v.config,
        calculatedFields: v.calculatedFields,
        createdAt: v.createdAt,
      });
      vizIds.set(v.id, created.id);
    }

    const created = await dashStore.createDashboard({
      datasetId: draft.datasetId,
      name: draft.name,
      description: draft.description,
    });
    dashboardId = created.id;
    await dashStore.updateDashboard(created.id, { filtersConfig: draft.filtersConfig });

    const sheets = [...draft.sheets].sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 0; i < sheets.length; i++) {
      const s = sheets[i];
      // Первый лист («Лист 1») стор создаёт сам — переименовываем его.
      const auto = i === 0 ? created.sheets[0] : undefined;
      const sheetId = auto
        ? (await dashStore.updateSheet(auto.id, { name: s.name })).id
        : (await dashStore.createSheet(created.id, s.name)).id;
      for (const w of s.widgets) {
        const vizId = w.visualizationId ? vizIds.get(w.visualizationId) : undefined;
        if (w.visualizationId && !vizId) {
          throw new Error(`Не найдена визуализация виджета «${w.title}»`);
        }
        await dashStore.createWidget(sheetId, {
          visualizationId: vizId,
          widgetType: w.widgetType,
          title: w.title,
          config: w.config,
          sortOrder: w.sortOrder,
          width: w.width,
        });
      }
    }

    rememberPlanDashboard(project.id, created.id);
    const full = useDashboardStore.getState().dashboards.find((d) => d.id === created.id);
    return full ?? created;
  } catch (e) {
    await rollback(dashboardId, [...vizIds.values()]);
    throw e;
  }
}

async function rollback(dashboardId: string | null, vizIds: string[]): Promise<void> {
  const dashStore = useDashboardStore.getState();
  const vizStore = useVisualizationStore.getState();
  if (dashboardId) {
    await dashStore
      .deleteDashboard(dashboardId)
      .catch((e: unknown) => console.warn("[plan] откат: дашборд не удалён", e));
  }
  for (const id of vizIds) {
    await vizStore
      .removeVisualization(id)
      .catch((e: unknown) => console.warn("[plan] откат: визуализация не удалена", e));
  }
}
