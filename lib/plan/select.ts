import type { PlanProject } from "../types";
import { DEMO_PLAN_DATASET_ID } from "./demo-project";

export interface PlanProjectPickOptions {
  /**
   * План нужен демо-объекту (демо-дашборд, демо-график: id `demo-…`). Его
   * поля — «Расход · выполнение %» и т.д. — заданы демо-планом, поэтому он
   * всегда считает по демо-проекту, даже если у пользователя есть свой
   * проект на том же демо-датасете (иначе карточки «0%», линия плана на нуле).
   */
  demoObject?: boolean;
  /**
   * Явный проект объекта (`config.planProjectId` графика/виджета из шаблона
   * «Собрать дашборд»). Найден на этом датасете — берётся он; нет (старые
   * объекты, проект удалён, другой датасет) — правило по датасету.
   */
  projectId?: string;
}

/**
 * План-проект датасета для конструктора, виджета, графика.
 * - Явный `projectId` (проект этого датасета) → он.
 * - Демо-объект → демо-проект датасета (если есть).
 * - Иначе — проект пользователя на этом датасете; нет своего — демо-проект.
 */
export function planProjectForDataset(
  projects: PlanProject[],
  datasetId: string,
  opts: PlanProjectPickOptions = {},
): PlanProject | undefined {
  const list = projects.filter((p) => p.datasetId === datasetId);
  if (opts.projectId) {
    const own = list.find((p) => p.id === opts.projectId);
    if (own) return own;
  }
  if (opts.demoObject) {
    const demo = list.find((p) => p.isDemo);
    if (demo) return demo;
  }
  return list.find((p) => !p.isDemo) ?? list[0];
}

/**
 * Можно ли создать план-проект на датасете. «Проект = датасет целиком» (Q6):
 * на датасете не больше одного своего проекта. Демо-проект не считается —
 * на демо-датасете свой проект создать можно (один).
 * `current` — правка существующего проекта: на прежнем датасете ему можно всё
 * (даже если там остались проекты, созданные до запрета), сам себе он не мешает.
 */
export type PlanProjectCreation = { ok: true } | { ok: false; existing: PlanProject };

export function canCreatePlanProject(
  projects: PlanProject[],
  datasetId: string,
  current?: Pick<PlanProject, "id" | "datasetId">,
): PlanProjectCreation {
  if (current && current.datasetId === datasetId) return { ok: true };
  const existing = projects.find(
    (p) => p.datasetId === datasetId && !p.isDemo && p.id !== current?.id,
  );
  return existing ? { ok: false, existing } : { ok: true };
}

/**
 * Что делает «Собрать дашборд план/факт» для проекта. Графики шаблона в БД
 * ссылаются на датасет по uuid (`visualizations.dataset_id`, FK на `datasets`),
 * а демо-датасета там нет — сохранить шаблон на нём нельзя. Поэтому на демо-датасете кнопка ведёт в
 * готовый демо-дашборд «План/факт», на своём датасете — собирает шаблон.
 */
export type PlanDashboardTarget = { kind: "demo" } | { kind: "build" };

export function planDashboardTarget(
  project: Pick<PlanProject, "datasetId">,
): PlanDashboardTarget {
  return project.datasetId === DEMO_PLAN_DATASET_ID ? { kind: "demo" } : { kind: "build" };
}
