import { create } from "zustand";
import type { PlanField, PlanProject } from "@/lib/types";
import {
  buildDemoPlanProject,
  isDemoPlanProjectId,
} from "@/lib/plan/demo-project";
import {
  canCreatePlanProject,
  planProjectForDataset,
  type PlanProjectPickOptions,
} from "@/lib/plan/select";
import {
  createPlanProject as sbCreateProject,
  deletePlanField as sbDeleteField,
  deletePlanProject as sbDeleteProject,
  getPlanProjects as sbList,
  setPlanValue as sbSetValue,
  updatePlanProject as sbUpdateProject,
  upsertPlanField as sbUpsertField,
} from "@/lib/supabase-db";

/** Текст ошибки при попытке править демо-план. */
export const DEMO_PLAN_READONLY_MESSAGE =
  "Демо-план только для чтения. Создайте свой план-проект, чтобы вписывать план.";

export type PlanFieldInput = Omit<PlanField, "id" | "projectId"> & { id?: string };

interface PlanState {
  /** Демо-проект всегда первый, дальше — проекты команды. */
  projects: PlanProject[];
  loading: boolean;
  loaded: boolean;
  error: string | null;

  /** Загрузить проекты один раз: повторный вызов во время или после загрузки ничего не делает. */
  load: () => Promise<void>;
  /** Принудительно перезагрузить проекты (например, кнопкой «Обновить»). */
  reload: () => Promise<void>;
  /** Залить проекты, уже загруженные сервером. */
  hydrate: (projects: PlanProject[]) => void;
  createProject: (data: {
    name: string;
    datasetId: string;
    dateColumn: string;
  }) => Promise<PlanProject>;
  updateProject: (
    id: string,
    patch: Partial<Pick<PlanProject, "name" | "datasetId" | "dateColumn">>,
  ) => Promise<PlanProject>;
  deleteProject: (id: string) => Promise<void>;
  upsertField: (projectId: string, field: PlanFieldInput) => Promise<PlanField>;
  deleteField: (fieldId: string) => Promise<void>;
  /** Оптимистично: сразу в сторе, при ошибке сохранения — откат и throw. `null` = удалить значение. */
  setValue: (fieldId: string, month: string, value: number | null) => Promise<void>;
  getProject: (id: string) => PlanProject | undefined;
  /**
   * План-проект датасета: свой проект команды приоритетнее демо; с
   * `demoObject` (демо-дашборд, демо-график) — всегда демо-план.
   */
  projectForDataset: (
    datasetId: string,
    opts?: PlanProjectPickOptions,
  ) => PlanProject | undefined;
  reset: () => void;
}

/** Предел ожидания ответа БД: дольше — считаем, что связь пропала (≈15 с). */
export const PLAN_REQUEST_TIMEOUT_MS = 15_000;
/** Текст ошибки, когда запись в БД не ответила за PLAN_REQUEST_TIMEOUT_MS. */
export const PLAN_SAVE_TIMEOUT_MESSAGE = "Не удалось сохранить — проверьте связь";
const PLAN_LOAD_TIMEOUT_MESSAGE = "Не удалось загрузить план-проекты — проверьте связь";

/**
 * Запрос с пределом ожидания: повисший запрос (сеть) не держит «Сохраняем…»
 * вечно — через PLAN_REQUEST_TIMEOUT_MS промис отклоняется понятной ошибкой.
 * Сам запрос не отменяется: если он всё же дойдёт, повтор запишет то же значение.
 */
/** Ошибка «БД не ответила вовремя»: UI отличает её от отказа БД по классу. */
export class PlanTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanTimeoutError";
  }
}

function withTimeout<T>(request: Promise<T>, message = PLAN_SAVE_TIMEOUT_MESSAGE): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PlanTimeoutError(message)), PLAN_REQUEST_TIMEOUT_MS);
    request.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function assertEditable(projectId: string): void {
  if (isDemoPlanProjectId(projectId)) throw new Error(DEMO_PLAN_READONLY_MESSAGE);
}

/** «Проект = датасет целиком» (Q6): второй свой проект на датасете не создаём. */
function assertDatasetFree(
  projects: PlanProject[],
  datasetId: string,
  current?: PlanProject,
): void {
  const check = canCreatePlanProject(projects, datasetId, current);
  if (!check.ok)
    throw new Error(`У этого датасета уже есть план-проект «${check.existing.name}»`);
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Демо-проект собирается на «сейчас», чтобы его месяцы не устаревали в долгой вкладке. */
function demoProject(): PlanProject {
  return buildDemoPlanProject(new Date());
}

function withDemo(projects: PlanProject[]): PlanProject[] {
  return [demoProject(), ...projects.filter((p) => !isDemoPlanProjectId(p.id))];
}

export const usePlanStore = create<PlanState>()((set, get) => {
  const projectOfField = (fieldId: string) =>
    get().projects.find((p) => p.fields.some((f) => f.id === fieldId));

  // Текущая загрузка списка — чтобы load()/reload() не запускали второй запрос.
  let inflight: Promise<void> | null = null;
  // Поколение загрузки: reset() его увеличивает, и ответ загрузки, начатой
  // до сброса (например, прежнего пользователя), в стор не попадает.
  let generation = 0;
  const fetchAll = async () => {
    const gen = generation;
    set({ loading: true, error: null });
    try {
      const real = await withTimeout(sbList(), PLAN_LOAD_TIMEOUT_MESSAGE);
      if (gen !== generation) return;
      set({ projects: withDemo(real), loading: false, loaded: true, error: null });
    } catch (e) {
      if (gen !== generation) return;
      set({ projects: withDemo([]), loading: false, loaded: true, error: errText(e) });
    }
  };

  const replaceProject = (id: string, fn: (p: PlanProject) => PlanProject) =>
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? fn(p) : p)),
    }));

  return {
    projects: [demoProject()],
    loading: false,
    loaded: false,
    error: null,

    load: async () => {
      if (inflight) return inflight;
      if (get().loaded) return;
      return get().reload();
    },

    reload: async () => {
      // Параллельные вызовы ждут один и тот же запрос.
      if (inflight) return inflight;
      const current = fetchAll().finally(() => {
        if (inflight === current) inflight = null;
      });
      inflight = current;
      return current;
    },

    hydrate: (projects) =>
      set({ projects: withDemo(projects), loading: false, loaded: true, error: null }),

    createProject: async (data) => {
      const name = data.name.trim();
      if (!name) throw new Error("Укажите название план-проекта");
      if (!data.datasetId) throw new Error("Выберите датасет");
      if (!data.dateColumn) throw new Error("Выберите колонку даты");
      assertDatasetFree(get().projects, data.datasetId);
      let created: PlanProject;
      try {
        created = await withTimeout(sbCreateProject({ ...data, name }));
      } catch (e) {
        // По таймауту запись могла пройти — перечитываем список, чтобы повтор
        // не создал дубль, а созданный проект не потерялся.
        if (e instanceof PlanTimeoutError) await get().reload();
        throw e;
      }
      set((state) => ({ projects: [...state.projects, created] }));
      return created;
    },

    updateProject: async (id, patch) => {
      assertEditable(id);
      if (patch.name !== undefined && !patch.name.trim())
        throw new Error("Название план-проекта не может быть пустым");
      if (patch.datasetId !== undefined && !patch.datasetId) throw new Error("Выберите датасет");
      if (patch.dateColumn !== undefined && !patch.dateColumn)
        throw new Error("Выберите колонку даты");
      if (patch.datasetId !== undefined) {
        const current = get().projects.find((p) => p.id === id);
        assertDatasetFree(get().projects, patch.datasetId, current);
      }
      const updated = await withTimeout(sbUpdateProject(id, patch));
      const current = get().getProject(id);
      const merged: PlanProject = current
        ? { ...current, ...updated, fields: current.fields, values: current.values }
        : updated;
      replaceProject(id, () => merged);
      return merged;
    },

    deleteProject: async (id) => {
      assertEditable(id);
      try {
        await withTimeout(sbDeleteProject(id));
      } catch (e) {
        // По таймауту удаление могло пройти — перечитываем, без «призрака».
        if (e instanceof PlanTimeoutError) await get().reload();
        throw e;
      }
      set((state) => ({ projects: state.projects.filter((p) => p.id !== id) }));
    },

    upsertField: async (projectId, field) => {
      assertEditable(projectId);
      const project = get().getProject(projectId);
      if (!project) throw new Error("План-проект не найден");
      const label = field.label.trim();
      if (!label) throw new Error("Укажите подпись поля плана");
      if (!field.sourceColumn) throw new Error("Выберите метрику датасета");
      // Подпись — часть имён виртуальных колонок, поэтому должна быть уникальной.
      if (project.fields.some((f) => f.id !== field.id && f.label === label))
        throw new Error(`Поле «${label}» уже есть в проекте`);
      const saved = await withTimeout(sbUpsertField(projectId, { ...field, label }));
      replaceProject(projectId, (p) => {
        const exists = p.fields.some((f) => f.id === saved.id);
        const fields = exists
          ? p.fields.map((f) => (f.id === saved.id ? saved : f))
          : [...p.fields, saved];
        return { ...p, fields: fields.sort((a, b) => a.sortOrder - b.sortOrder) };
      });
      return saved;
    },

    deleteField: async (fieldId) => {
      const project = projectOfField(fieldId);
      if (!project) throw new Error("Поле плана не найдено");
      assertEditable(project.id);
      await withTimeout(sbDeleteField(fieldId));
      replaceProject(project.id, (p) => {
        const values = { ...p.values };
        delete values[fieldId];
        return { ...p, fields: p.fields.filter((f) => f.id !== fieldId), values };
      });
    },

    setValue: async (fieldId, month, value) => {
      const project = projectOfField(fieldId);
      if (!project) throw new Error("Поле плана не найдено");
      assertEditable(project.id);
      if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Месяц должен быть в формате ГГГГ-ММ");
      if (value !== null && !Number.isFinite(value)) throw new Error("План должен быть числом");

      const prev = project.values[fieldId]?.[month];
      const apply = (v: number | null | undefined) =>
        replaceProject(project.id, (p) => {
          const row = { ...(p.values[fieldId] ?? {}) };
          if (v === null || v === undefined) delete row[month];
          else row[month] = v;
          return { ...p, values: { ...p.values, [fieldId]: row } };
        });

      apply(value);
      try {
        await withTimeout(sbSetValue(fieldId, month, value));
      } catch (e) {
        // Откат только этой ячейки — соседние правки не теряем.
        apply(prev);
        set({ error: errText(e) });
        throw e;
      }
    },

    getProject: (id) => get().projects.find((p) => p.id === id),

    projectForDataset: (datasetId, opts) =>
      planProjectForDataset(get().projects, datasetId, opts),

    reset: () => {
      generation += 1;
      inflight = null;
      set({ projects: [demoProject()], loading: false, loaded: false, error: null });
    },
  };
});
