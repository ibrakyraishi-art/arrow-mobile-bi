import { create } from "zustand";
import type { Dataset } from "@/lib/types";
import { DEMO_DATASET_ID, buildDemoDataset } from "@/lib/demo-data";
import {
  createDataset as sbCreate,
  deleteDataset as sbDelete,
  getDatasets as sbList,
  updateDataset as sbUpdate,
} from "@/lib/supabase-db";

interface DatasetState {
  datasets: Dataset[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  currentUserId: string | null;

  loadFromSupabase: (userId: string) => Promise<void>;
  /** Залить данные, уже загруженные сервером (/api/bootstrap). */
  hydrate: (userId: string, datasets: Dataset[]) => void;
  addDataset: (dataset: Omit<Dataset, "id">) => Promise<Dataset>;
  updateDataset: (id: string, patch: Partial<Dataset>) => Promise<Dataset>;
  removeDataset: (id: string) => Promise<void>;
  reset: () => void;

  getDataset: (id: string) => Dataset | undefined;
}

// Демо-датасет «Мобильный маркетинг (демо)» (lib/demo-data.ts) — одинаков у всех,
// живёт только в памяти; на него ссылается демо-план и демо-дашборды.
// Собирается на «сейчас» при инициализации, загрузке и сбросе стора (как демо-план).
function demoDataset(): Dataset {
  return buildDemoDataset(new Date());
}

function isDemoDatasetId(id: string): boolean {
  return id === DEMO_DATASET_ID;
}

export const useDatasetStore = create<DatasetState>()((set, get) => ({
  datasets: [demoDataset()],
  loading: false,
  loaded: false,
  error: null,
  currentUserId: null,

  loadFromSupabase: async (userId) => {
    set({ loading: true, error: null, currentUserId: userId });
    try {
      const real = await sbList(userId);
      set({
        datasets: [demoDataset(), ...real],
        loading: false,
        loaded: true,
        error: null,
      });
    } catch (e) {
      set({
        datasets: [demoDataset()],
        loading: false,
        loaded: true,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  hydrate: (userId, datasets) =>
    set({
      datasets: [demoDataset(), ...datasets],
      loading: false,
      loaded: true,
      error: null,
      currentUserId: userId,
    }),

  addDataset: async (dataset) => {
    const userId = get().currentUserId;
    if (!userId) throw new Error("Нет активной сессии");
    const created = await sbCreate(userId, dataset);
    set((state) => ({ datasets: [...state.datasets, created] }));
    return created;
  },

  updateDataset: async (id, patch) => {
    if (isDemoDatasetId(id)) {
      const existing = get().datasets.find((d) => d.id === id);
      if (!existing) throw new Error("Демо-датасет не найден");
      const merged = { ...existing, ...patch };
      set((state) => ({
        datasets: state.datasets.map((d) => (d.id === id ? merged : d)),
      }));
      return merged;
    }
    const updated = await sbUpdate(id, patch);
    set((state) => ({
      datasets: state.datasets.map((d) => (d.id === id ? updated : d)),
    }));
    return updated;
  },

  removeDataset: async (id) => {
    if (isDemoDatasetId(id)) return;
    await sbDelete(id);
    set((state) => ({
      datasets: state.datasets.filter((d) => d.id !== id),
    }));
  },

  reset: () =>
    set({
      datasets: [demoDataset()],
      loading: false,
      loaded: false,
      error: null,
      currentUserId: null,
    }),

  getDataset: (id) => get().datasets.find((d) => d.id === id),
}));
