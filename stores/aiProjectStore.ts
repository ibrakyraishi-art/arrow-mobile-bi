import { create } from "zustand";
import type { AIProject, AIProjectRun, FilterCondition } from "@/lib/types";
import {
  createAiProject as sbCreate,
  createAiProjectRun as sbCreateRun,
  deleteAiProject as sbDelete,
  deleteAiProjectRun as sbDeleteRun,
  duplicateAiProject as sbDuplicate,
  getAiProject as sbGet,
  getAiProjectRuns as sbGetRuns,
  getAiProjects as sbList,
  updateAiProject as sbUpdate,
} from "@/lib/supabase-db";

interface AiProjectState {
  projects: AIProject[];
  currentProject: AIProject | null;
  runs: AIProjectRun[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  currentUserId: string | null;

  loadFromSupabase: (userId: string) => Promise<void>;
  /** Залить данные, уже загруженные сервером (/api/bootstrap). */
  hydrate: (userId: string, projects: AIProject[]) => void;
  loadProject: (id: string) => Promise<AIProject | null>;
  createProject: (data: {
    name: string;
    description?: string;
    datasetId: string;
  }) => Promise<AIProject>;
  updateProject: (
    id: string,
    updates: Partial<
      Pick<
        AIProject,
        | "name"
        | "description"
        | "datasetId"
        | "model"
        | "filtersConfig"
        | "filterValues"
        | "prompt"
        | "builderConfig"
        | "confidentialColumns"
        | "includeFunnel"
      >
    >,
  ) => Promise<AIProject>;
  deleteProject: (id: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<AIProject>;

  createRun: (
    projectId: string,
    data: {
      prompt: string;
      response: string;
      cost: number;
      model: AIProject["model"];
      inputTokens: number;
      outputTokens: number;
      filtersSnapshot: FilterCondition[];
    },
  ) => Promise<AIProjectRun>;
  deleteRun: (id: string) => Promise<void>;

  reset: () => void;
}

export const useAiProjectStore = create<AiProjectState>()((set, get) => ({
  projects: [],
  currentProject: null,
  runs: [],
  loading: false,
  loaded: false,
  error: null,
  currentUserId: null,

  loadFromSupabase: async (userId) => {
    set({ loading: true, error: null, currentUserId: userId });
    try {
      const projects = await sbList(userId);
      set({ projects, loading: false, loaded: true, error: null });
    } catch (e) {
      set({
        projects: [],
        loading: false,
        loaded: true,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  hydrate: (userId, projects) =>
    set({ projects, loading: false, loaded: true, error: null, currentUserId: userId }),

  loadProject: async (id) => {
    set({ loading: true, error: null });
    try {
      const [project, runs] = await Promise.all([sbGet(id), sbGetRuns(id, 30)]);
      set({ currentProject: project, runs, loading: false });
      if (project) {
        set((state) => ({
          projects: state.projects.map((p) => (p.id === project.id ? project : p)),
        }));
      }
      return project;
    } catch (e) {
      set({
        currentProject: null,
        runs: [],
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  },

  createProject: async (data) => {
    const userId = get().currentUserId;
    if (!userId) throw new Error("Нет активной сессии");
    const created = await sbCreate(userId, data);
    set((state) => ({ projects: [created, ...state.projects] }));
    return created;
  },

  updateProject: async (id, updates) => {
    const updated = await sbUpdate(id, updates);
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...updated } : p,
      ),
      currentProject:
        state.currentProject?.id === id
          ? { ...state.currentProject, ...updated }
          : state.currentProject,
    }));
    return updated;
  },

  deleteProject: async (id) => {
    await sbDelete(id);
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      currentProject:
        state.currentProject?.id === id ? null : state.currentProject,
    }));
  },

  duplicateProject: async (id) => {
    const userId = get().currentUserId;
    if (!userId) throw new Error("Нет активной сессии");
    const copy = await sbDuplicate(userId, id);
    set((state) => ({ projects: [copy, ...state.projects] }));
    return copy;
  },

  createRun: async (projectId, data) => {
    const userId = get().currentUserId;
    if (!userId) throw new Error("Нет активной сессии");
    const run = await sbCreateRun(projectId, userId, data);
    set((state) => ({
      runs: [run, ...state.runs].slice(0, 30),
      projects: state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              runCount: (p.runCount ?? 0) + 1,
              lastRunAt: run.createdAt,
            }
          : p,
      ),
      currentProject:
        state.currentProject?.id === projectId
          ? {
              ...state.currentProject,
              runCount: (state.currentProject.runCount ?? 0) + 1,
              lastRunAt: run.createdAt,
            }
          : state.currentProject,
    }));
    return run;
  },

  deleteRun: async (id) => {
    await sbDeleteRun(id);
    set((state) => ({ runs: state.runs.filter((r) => r.id !== id) }));
  },

  reset: () =>
    set({
      projects: [],
      currentProject: null,
      runs: [],
      loading: false,
      loaded: false,
      error: null,
      currentUserId: null,
    }),
}));
