import { create } from "zustand";
import type { Dashboard, DashboardSheet, DashboardWidget } from "@/lib/types";
import {
  DEMO_OVERVIEW_DASHBOARD_ID,
  DEMO_PLAN_DASHBOARD_ID,
  buildDemoDashboards,
  isDemoObjectId,
} from "@/lib/demo-data";
import { generateId } from "@/lib/utils";
import {
  createDashboard as sbCreateDashboard,
  createSheet as sbCreateSheet,
  createWidget as sbCreateWidget,
  deleteDashboard as sbDeleteDashboard,
  deleteSheet as sbDeleteSheet,
  deleteWidget as sbDeleteWidget,
  getDashboard as sbGetDashboard,
  getDashboards as sbGetDashboards,
  reorderWidgets as sbReorderWidgets,
  updateDashboard as sbUpdateDashboard,
  updateSheet as sbUpdateSheet,
  updateWidget as sbUpdateWidget,
} from "@/lib/supabase-db";

/** Демо-дашборд «Обзор Arrow Mobile» (прежнее имя экспорта — для совместимости). */
export const DEMO_DASHBOARD_ID = DEMO_OVERVIEW_DASHBOARD_ID;
export { DEMO_OVERVIEW_DASHBOARD_ID, DEMO_PLAN_DASHBOARD_ID };
const DEMO_DASHBOARD_IDS = new Set([DEMO_OVERVIEW_DASHBOARD_ID, DEMO_PLAN_DASHBOARD_ID]);
/** Префикс листов, созданных пользователем на демо-дашборде (только в памяти). */
const DEMO_SHEET_PREFIX = "demo-dashboard-sheet-";
const DEMO_WIDGET_PREFIX = "demo-w-";

function nowIso(): string {
  return new Date().toISOString();
}

function isDemoDashboardId(id: string): boolean {
  return DEMO_DASHBOARD_IDS.has(id);
}

// Демо-листы и демо-виджеты (сиды и созданные поверх демо) — все с префиксом `demo-`.
function isDemoSheetId(id: string): boolean {
  return isDemoObjectId(id);
}

function isDemoWidgetId(id: string): boolean {
  return isDemoObjectId(id);
}

function findDashboardIdBySheet(
  dashboards: Dashboard[],
  sheetId: string,
): string | null {
  for (const d of dashboards) {
    if (d.sheets.some((s) => s.id === sheetId)) return d.id;
  }
  return null;
}

function findDashboardIdByWidget(
  dashboards: Dashboard[],
  widgetId: string,
): string | null {
  for (const d of dashboards) {
    for (const s of d.sheets) {
      if (s.widgets.some((w) => w.id === widgetId)) return d.id;
    }
  }
  return null;
}

interface DashboardState {
  dashboards: Dashboard[];
  currentDashboard: Dashboard | null;
  activeFilters: Record<string, unknown>;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  currentUserId: string | null;

  loadFromSupabase: (userId: string) => Promise<void>;
  /** Залить данные, уже загруженные сервером (/api/bootstrap). */
  hydrate: (userId: string, dashboards: Dashboard[]) => void;
  loadDashboard: (id: string) => Promise<Dashboard | null>;

  createDashboard: (data: {
    datasetId: string;
    name: string;
    description?: string;
  }) => Promise<Dashboard>;
  updateDashboard: (
    id: string,
    updates: Partial<Pick<Dashboard, "name" | "description" | "filtersConfig" | "datasetId">>,
  ) => Promise<Dashboard>;
  deleteDashboard: (id: string) => Promise<void>;
  duplicateDashboard: (id: string) => Promise<Dashboard>;

  createSheet: (dashboardId: string, name: string) => Promise<DashboardSheet>;
  updateSheet: (
    id: string,
    updates: Partial<Pick<DashboardSheet, "name" | "sortOrder">>,
  ) => Promise<DashboardSheet>;
  deleteSheet: (id: string) => Promise<void>;

  createWidget: (
    sheetId: string,
    widget: Omit<DashboardWidget, "id" | "sheetId">,
  ) => Promise<DashboardWidget>;
  updateWidget: (
    id: string,
    updates: Partial<Omit<DashboardWidget, "id" | "sheetId">>,
  ) => Promise<DashboardWidget>;
  deleteWidget: (id: string) => Promise<void>;
  reorderWidgets: (items: { id: string; sortOrder: number }[]) => Promise<void>;

  setFilterValue: (filterId: string, value: unknown) => void;
  resetFilters: () => void;
  reset: () => void;
}

// Демо-дашборды «Обзор Arrow Mobile» и «План/факт» (lib/demo-data.ts) — одинаковы
// у всех, живут только в памяти.
// Собираются на «сейчас» при инициализации, загрузке и сбросе стора (как демо-план).
function demoDashboards(): Dashboard[] {
  return buildDemoDashboards(new Date());
}

export const useDashboardStore = create<DashboardState>()((set, get) => ({
  dashboards: demoDashboards(),
  currentDashboard: null,
  activeFilters: {},
  loading: false,
  loaded: false,
  error: null,
  currentUserId: null,

  loadFromSupabase: async (userId) => {
    set({ loading: true, error: null, currentUserId: userId });
    try {
      const real = await sbGetDashboards(userId);
      set({
        dashboards: [...demoDashboards(), ...real],
        loading: false,
        loaded: true,
        error: null,
      });
    } catch (e) {
      set({
        dashboards: demoDashboards(),
        loading: false,
        loaded: true,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  hydrate: (userId, dashboards) =>
    set({
      dashboards: [...demoDashboards(), ...dashboards],
      loading: false,
      loaded: true,
      error: null,
      currentUserId: userId,
    }),

  loadDashboard: async (id) => {
    if (isDemoDashboardId(id)) {
      // Демо-дашборд живёт только в памяти. Используем существующий из стора,
      // чтобы не потерять пользовательские изменения (новые виджеты/листы и т.п.).
      const existing = get().dashboards.find((d) => d.id === id);
      const dashboard =
        existing ?? demoDashboards().find((d) => d.id === id) ?? null;
      set({ currentDashboard: dashboard });
      return dashboard;
    }
    const full = await sbGetDashboard(id);
    set({ currentDashboard: full });
    if (full) {
      set((state) => ({
        dashboards: state.dashboards.map((d) => (d.id === full.id ? full : d)),
      }));
    }
    return full;
  },

  createDashboard: async (data) => {
    const userId = get().currentUserId;
    if (!userId) throw new Error("Нет активной сессии");
    const created = await sbCreateDashboard(userId, data);
    set((state) => ({ dashboards: [...state.dashboards, created] }));
    return created;
  },

  updateDashboard: async (id, updates) => {
    if (isDemoDashboardId(id)) {
      const existing = get().dashboards.find((d) => d.id === id);
      if (!existing) throw new Error("Демо-дашборд не найден");
      const merged: Dashboard = {
        ...existing,
        ...updates,
        updatedAt: nowIso(),
      };
      set((state) => ({
        dashboards: state.dashboards.map((d) => (d.id === id ? merged : d)),
        currentDashboard:
          state.currentDashboard?.id === id ? merged : state.currentDashboard,
      }));
      return merged;
    }
    const updated = await sbUpdateDashboard(id, updates);
    set((state) => {
      const existing = state.dashboards.find((d) => d.id === id);
      const withSheets: Dashboard = {
        ...updated,
        sheets: existing?.sheets ?? [],
      };
      return {
        dashboards: state.dashboards.map((d) =>
          d.id === id ? withSheets : d,
        ),
        currentDashboard:
          state.currentDashboard?.id === id
            ? { ...state.currentDashboard, ...updated }
            : state.currentDashboard,
      };
    });
    return updated;
  },

  deleteDashboard: async (id) => {
    if (isDemoDashboardId(id)) return;
    await sbDeleteDashboard(id);
    set((state) => ({
      dashboards: state.dashboards.filter((d) => d.id !== id),
      currentDashboard:
        state.currentDashboard?.id === id ? null : state.currentDashboard,
    }));
  },

  duplicateDashboard: async (id) => {
    const userId = get().currentUserId;
    if (!userId) throw new Error("Нет активной сессии");
    const source = await get().loadDashboard(id);
    if (!source) throw new Error("Дашборд не найден");
    const created = await sbCreateDashboard(userId, {
      datasetId: source.datasetId,
      name: `${source.name} (копия)`,
      description: source.description,
      filtersConfig: source.filtersConfig,
    });
    // created has "Лист 1" auto-created; replace with real sheets/widgets.
    if (created.sheets[0]) {
      await sbDeleteSheet(created.sheets[0].id);
    }
    const newSheets: DashboardSheet[] = [];
    for (const sheet of source.sheets) {
      const newSheet = await sbCreateSheet(created.id, sheet.name);
      const newWidgets: DashboardWidget[] = [];
      for (const w of sheet.widgets) {
        const newW = await sbCreateWidget(newSheet.id, {
          visualizationId: w.visualizationId,
          widgetType: w.widgetType,
          title: w.title,
          config: w.config,
          sortOrder: w.sortOrder,
          width: w.width,
        });
        newWidgets.push(newW);
      }
      newSheet.widgets = newWidgets;
      newSheets.push(newSheet);
    }
    const fullCopy: Dashboard = { ...created, sheets: newSheets };
    set((state) => ({
      dashboards: [...state.dashboards, fullCopy],
    }));
    return fullCopy;
  },

  createSheet: async (dashboardId, name) => {
    if (isDemoDashboardId(dashboardId)) {
      // Демо-дашборд: создаём лист in-memory с локальным ID.
      const existing = get().dashboards.find((d) => d.id === dashboardId);
      const maxSort = existing
        ? existing.sheets.reduce((m, s) => Math.max(m, s.sortOrder), -1)
        : -1;
      const created: DashboardSheet = {
        id: `${DEMO_SHEET_PREFIX}${generateId()}`,
        dashboardId,
        name,
        sortOrder: maxSort + 1,
        widgets: [],
      };
      const patch = (d: Dashboard): Dashboard =>
        d.id === dashboardId
          ? { ...d, sheets: [...d.sheets, created], updatedAt: nowIso() }
          : d;
      set((state) => ({
        dashboards: state.dashboards.map(patch),
        currentDashboard:
          state.currentDashboard && state.currentDashboard.id === dashboardId
            ? patch(state.currentDashboard)
            : state.currentDashboard,
      }));
      return created;
    }
    const created = await sbCreateSheet(dashboardId, name);
    set((state) => {
      const patchDashboard = (d: Dashboard): Dashboard =>
        d.id === dashboardId
          ? { ...d, sheets: [...d.sheets, created], updatedAt: nowIso() }
          : d;
      return {
        dashboards: state.dashboards.map(patchDashboard),
        currentDashboard:
          state.currentDashboard && state.currentDashboard.id === dashboardId
            ? patchDashboard(state.currentDashboard)
            : state.currentDashboard,
      };
    });
    return created;
  },

  updateSheet: async (id, updates) => {
    const isDemoSheet = isDemoSheetId(id);
    let updated: DashboardSheet;
    if (isDemoSheet) {
      const found = get()
        .dashboards.flatMap((d) => d.sheets)
        .find((s) => s.id === id);
      if (!found) throw new Error("Лист не найден");
      updated = { ...found, ...updates, widgets: found.widgets };
    } else {
      updated = await sbUpdateSheet(id, updates);
    }
    set((state) => {
      const patchSheets = (sheets: DashboardSheet[]): DashboardSheet[] =>
        sheets.map((s) =>
          s.id === id ? { ...s, ...updated, widgets: s.widgets } : s,
        );
      return {
        dashboards: state.dashboards.map((d) => ({
          ...d,
          sheets: patchSheets(d.sheets),
        })),
        currentDashboard: state.currentDashboard
          ? {
              ...state.currentDashboard,
              sheets: patchSheets(state.currentDashboard.sheets),
            }
          : null,
      };
    });
    return updated;
  },

  deleteSheet: async (id) => {
    if (!isDemoSheetId(id)) {
      await sbDeleteSheet(id);
    }
    set((state) => {
      const filterSheets = (sheets: DashboardSheet[]): DashboardSheet[] =>
        sheets.filter((s) => s.id !== id);
      return {
        dashboards: state.dashboards.map((d) => ({
          ...d,
          sheets: filterSheets(d.sheets),
        })),
        currentDashboard: state.currentDashboard
          ? {
              ...state.currentDashboard,
              sheets: filterSheets(state.currentDashboard.sheets),
            }
          : null,
      };
    });
  },

  createWidget: async (sheetId, widget) => {
    const isDemoSheet = isDemoSheetId(sheetId);
    const dashboardIdForSheet = findDashboardIdBySheet(
      get().dashboards,
      sheetId,
    );
    const isDemoDash =
      dashboardIdForSheet !== null &&
      isDemoDashboardId(dashboardIdForSheet);
    // Для демо-дашборда (или демо-листа) создаём виджет только в памяти,
    // чтобы не пытаться писать демо-ID в Supabase.
    let created: DashboardWidget;
    if (isDemoSheet || isDemoDash) {
      created = {
        ...widget,
        id: `${DEMO_WIDGET_PREFIX}${generateId()}`,
        sheetId,
      };
    } else {
      created = await sbCreateWidget(sheetId, widget);
    }
    set((state) => {
      const patchSheets = (sheets: DashboardSheet[]): DashboardSheet[] =>
        sheets.map((s) =>
          s.id === sheetId
            ? { ...s, widgets: [...s.widgets, created] }
            : s,
        );
      return {
        dashboards: state.dashboards.map((d) => ({
          ...d,
          sheets: patchSheets(d.sheets),
        })),
        currentDashboard: state.currentDashboard
          ? {
              ...state.currentDashboard,
              sheets: patchSheets(state.currentDashboard.sheets),
            }
          : null,
      };
    });
    return created;
  },

  updateWidget: async (id, updates) => {
    const isDemoW = isDemoWidgetId(id);
    const dashboardIdForWidget = findDashboardIdByWidget(
      get().dashboards,
      id,
    );
    const isDemoDash =
      dashboardIdForWidget !== null &&
      isDemoDashboardId(dashboardIdForWidget);
    let updated: DashboardWidget;
    if (isDemoW || isDemoDash) {
      const found = get()
        .dashboards.flatMap((d) => d.sheets)
        .flatMap((s) => s.widgets)
        .find((w) => w.id === id);
      if (!found) throw new Error("Виджет не найден");
      updated = { ...found, ...updates };
    } else {
      updated = await sbUpdateWidget(id, updates);
    }
    set((state) => {
      const patchSheets = (sheets: DashboardSheet[]): DashboardSheet[] =>
        sheets.map((s) => ({
          ...s,
          widgets: s.widgets.map((w) => (w.id === id ? { ...w, ...updated } : w)),
        }));
      return {
        dashboards: state.dashboards.map((d) => ({
          ...d,
          sheets: patchSheets(d.sheets),
        })),
        currentDashboard: state.currentDashboard
          ? {
              ...state.currentDashboard,
              sheets: patchSheets(state.currentDashboard.sheets),
            }
          : null,
      };
    });
    return updated;
  },

  deleteWidget: async (id) => {
    const isDemoW = isDemoWidgetId(id);
    const dashboardIdForWidget = findDashboardIdByWidget(
      get().dashboards,
      id,
    );
    const isDemoDash =
      dashboardIdForWidget !== null &&
      isDemoDashboardId(dashboardIdForWidget);
    if (!isDemoW && !isDemoDash) {
      await sbDeleteWidget(id);
    }
    set((state) => {
      const patchSheets = (sheets: DashboardSheet[]): DashboardSheet[] =>
        sheets.map((s) => ({
          ...s,
          widgets: s.widgets.filter((w) => w.id !== id),
        }));
      return {
        dashboards: state.dashboards.map((d) => ({
          ...d,
          sheets: patchSheets(d.sheets),
        })),
        currentDashboard: state.currentDashboard
          ? {
              ...state.currentDashboard,
              sheets: patchSheets(state.currentDashboard.sheets),
            }
          : null,
      };
    });
  },

  reorderWidgets: async (items) => {
    await sbReorderWidgets(items);
    const byId = new Map(items.map((i) => [i.id, i.sortOrder]));
    set((state) => {
      const patchSheets = (sheets: DashboardSheet[]): DashboardSheet[] =>
        sheets.map((s) => ({
          ...s,
          widgets: s.widgets
            .map((w) =>
              byId.has(w.id) ? { ...w, sortOrder: byId.get(w.id)! } : w,
            )
            .sort((a, b) => a.sortOrder - b.sortOrder),
        }));
      return {
        dashboards: state.dashboards.map((d) => ({
          ...d,
          sheets: patchSheets(d.sheets),
        })),
        currentDashboard: state.currentDashboard
          ? {
              ...state.currentDashboard,
              sheets: patchSheets(state.currentDashboard.sheets),
            }
          : null,
      };
    });
  },

  setFilterValue: (filterId, value) => {
    set((state) => ({
      activeFilters: { ...state.activeFilters, [filterId]: value },
    }));
  },

  resetFilters: () => {
    set({ activeFilters: {} });
  },

  reset: () =>
    set({
      dashboards: demoDashboards(),
      currentDashboard: null,
      activeFilters: {},
      loading: false,
      loaded: false,
      error: null,
      currentUserId: null,
    }),
}));
