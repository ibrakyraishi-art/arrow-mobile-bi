import { create } from "zustand";
import type { Visualization } from "@/lib/types";
import {
  DEMO_DATASET_ID,
  DEMO_SAVE_HINT,
  buildDemoVisualizations,
  isDemoObjectId,
} from "@/lib/demo-data";
import {
  createVisualization as sbCreate,
  deleteVisualization as sbDelete,
  getVisualizations as sbList,
  updateVisualization as sbUpdate,
} from "@/lib/supabase-db";

/**
 * График на демо-датасете: в БД `visualizations.dataset_id` — uuid с FK на
 * `datasets`, а демо-датасета там нет (сырой ответ БД — «invalid input syntax
 * for type uuid»). Бросается до запроса, чтобы UI показал понятный текст.
 */
export class DemoVisualizationSaveError extends Error {
  constructor() {
    super(DEMO_SAVE_HINT);
    this.name = "DemoVisualizationSaveError";
  }
}

interface VisualizationState {
  visualizations: Visualization[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  currentUserId: string | null;

  loadFromSupabase: (userId: string) => Promise<void>;
  /** Залить данные, уже загруженные сервером (/api/bootstrap). */
  hydrate: (userId: string, visualizations: Visualization[]) => void;
  addVisualization: (v: Omit<Visualization, "id">) => Promise<Visualization>;
  updateVisualization: (
    id: string,
    patch: Partial<Visualization>,
  ) => Promise<Visualization>;
  removeVisualization: (id: string) => Promise<void>;
  reset: () => void;

  getVisualization: (id: string) => Visualization | undefined;
}

// Демо-визуализации витрины и шаблона план/факт (lib/demo-data.ts) — одинаковы
// у всех, живут только в памяти. Правки демо не уходят в Supabase.
// Собираются на «сейчас» при инициализации, загрузке и сбросе стора (как демо-план).
function demoVizs(): Visualization[] {
  return buildDemoVisualizations(new Date());
}

function isDemoVizId(id: string): boolean {
  return isDemoObjectId(id);
}

export const useVisualizationStore = create<VisualizationState>()(
  (set, get) => ({
    visualizations: demoVizs(),
    loading: false,
    loaded: false,
    error: null,
    currentUserId: null,

    loadFromSupabase: async (userId) => {
      set({ loading: true, error: null, currentUserId: userId });
      try {
        const real = await sbList(userId);
        set({
          visualizations: [...demoVizs(), ...real],
          loading: false,
          loaded: true,
          error: null,
        });
      } catch (e) {
        set({
          visualizations: demoVizs(),
          loading: false,
          loaded: true,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },

    hydrate: (userId, visualizations) =>
      set({
        visualizations: [...demoVizs(), ...visualizations],
        loading: false,
        loaded: true,
        error: null,
        currentUserId: userId,
      }),

    addVisualization: async (v) => {
      const userId = get().currentUserId;
      if (!userId) throw new Error("Нет активной сессии");
      if (v.datasetId === DEMO_DATASET_ID) throw new DemoVisualizationSaveError();
      const created = await sbCreate(userId, v);
      set((state) => ({
        visualizations: [...state.visualizations, created],
      }));
      return created;
    },

    updateVisualization: async (id, patch) => {
      if (isDemoVizId(id)) {
        const existing = get().visualizations.find((v) => v.id === id);
        if (!existing) throw new Error("Демо-визуализация не найдена");
        const merged = { ...existing, ...patch };
        set((state) => ({
          visualizations: state.visualizations.map((v) =>
            v.id === id ? merged : v,
          ),
        }));
        return merged;
      }
      // Свой график, переключённый на демо-датасет, в БД тоже не сохранить.
      if (patch.datasetId === DEMO_DATASET_ID) throw new DemoVisualizationSaveError();
      const updated = await sbUpdate(id, patch);
      set((state) => ({
        visualizations: state.visualizations.map((v) =>
          v.id === id ? updated : v,
        ),
      }));
      return updated;
    },

    removeVisualization: async (id) => {
      if (isDemoVizId(id)) return;
      await sbDelete(id);
      set((state) => ({
        visualizations: state.visualizations.filter((v) => v.id !== id),
      }));
    },

    reset: () =>
      set({
        visualizations: demoVizs(),
        loading: false,
        loaded: false,
        error: null,
        currentUserId: null,
      }),

    getVisualization: (id) =>
      get().visualizations.find((v) => v.id === id),
  }),
);
