import { BRAND_NAME } from "@/lib/brand";
import { create } from "zustand";
import type { DataSource } from "@/lib/types";
import { DEMO_SOURCE_ID, DEMO_TABLE } from "@/lib/demo-data";
import {
  createDataSource as sbCreate,
  createFileDataSource as sbCreateFile,
  deleteDataSource as sbDelete,
  getDataSources as sbList,
  updateDataSource as sbUpdate,
} from "@/lib/supabase-db";
import type { QueryResultRow, DatasetColumnType } from "@/lib/types";

interface DataSourceState {
  sources: DataSource[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  currentUserId: string | null;

  loadFromSupabase: (userId: string) => Promise<void>;
  /** Залить данные, уже загруженные сервером (/api/bootstrap). */
  hydrate: (userId: string, sources: DataSource[]) => void;
  addDataSource: (source: Omit<DataSource, "id">) => Promise<DataSource>;
  /** Создать файловый источник (CSV/Excel/Sheets): источник + датасет. */
  createFileSource: (payload: {
    name: string;
    description?: string;
    format: "csv" | "excel" | "gsheet";
    columns: { name: string; type: DatasetColumnType }[];
    rows: QueryResultRow[];
    sourceMeta?: Record<string, unknown>;
    mode?: "snapshot" | "live";
  }) => Promise<{ source: DataSource; datasetId: string }>;
  updateDataSource: (
    id: string,
    patch: Partial<DataSource>,
  ) => Promise<DataSource>;
  removeDataSource: (id: string) => Promise<void>;
  reset: () => void;

  getSource: (id: string) => DataSource | undefined;
}

const demoSource: DataSource = {
  id: DEMO_SOURCE_ID,
  name: `Демо: мобильный маркетинг (${BRAND_NAME})`,
  host: "demo.clickhouse.local",
  port: 8443,
  database: "analytics",
  user: "demo",
  password: "",
  ssl: true,
  status: "connected",
  createdAt: new Date().toISOString(),
  tables: [DEMO_TABLE],
  isDemo: true,
};

export const useDataSourceStore = create<DataSourceState>()((set, get) => ({
  sources: [demoSource],
  loading: false,
  loaded: false,
  error: null,
  currentUserId: null,

  loadFromSupabase: async (userId) => {
    set({ loading: true, error: null, currentUserId: userId });
    try {
      const real = await sbList(userId);
      set({
        sources: [demoSource, ...real],
        loading: false,
        loaded: true,
        error: null,
      });
    } catch (e) {
      set({
        sources: [demoSource],
        loading: false,
        loaded: true,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  hydrate: (userId, sources) =>
    set({
      sources: [demoSource, ...sources],
      loading: false,
      loaded: true,
      error: null,
      currentUserId: userId,
    }),

  addDataSource: async (source) => {
    const userId = get().currentUserId;
    if (!userId) throw new Error("Нет активной сессии");
    const created = await sbCreate(userId, source);
    set((state) => ({ sources: [...state.sources, created] }));
    return created;
  },

  createFileSource: async (payload) => {
    const userId = get().currentUserId;
    if (!userId) throw new Error("Нет активной сессии");
    // Живой режим (Google Sheets) создаём НА СЕРВЕРЕ: вставки идут через
    // Vercel↔Supabase — надёжно и быстро, без флаки трансграничных запросов из
    // браузера (они давали «Failed to fetch»). Снапшот (CSV/Excel) оставляем
    // прежним прямым путём — большие файлы, без лимита тела serverless-функции.
    if (payload.mode === "live") {
      const res = await fetch("/api/data-sources/create-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as {
        source?: DataSource;
        datasetId?: string;
        error?: string;
      };
      if (!res.ok || !json.source || !json.datasetId) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      const source = json.source;
      const datasetId = json.datasetId;
      set((state) => ({ sources: [...state.sources, source] }));
      return { source, datasetId };
    }
    const result = await sbCreateFile(userId, payload);
    set((state) => ({ sources: [...state.sources, result.source] }));
    return result;
  },

  updateDataSource: async (id, patch) => {
    const existing = get().sources.find((s) => s.id === id);
    if (existing?.isDemo) {
      const merged = { ...existing, ...patch };
      set((state) => ({
        sources: state.sources.map((s) => (s.id === id ? merged : s)),
      }));
      return merged;
    }
    const updated = await sbUpdate(id, patch);
    set((state) => ({
      sources: state.sources.map((s) => (s.id === id ? updated : s)),
    }));
    return updated;
  },

  removeDataSource: async (id) => {
    const existing = get().sources.find((s) => s.id === id);
    if (existing?.isDemo) return;
    await sbDelete(id);
    set((state) => ({
      sources: state.sources.filter((s) => s.id !== id),
    }));
  },

  reset: () =>
    set({
      sources: [demoSource],
      loading: false,
      loaded: false,
      error: null,
      currentUserId: null,
    }),

  getSource: (id) => get().sources.find((s) => s.id === id),
}));
