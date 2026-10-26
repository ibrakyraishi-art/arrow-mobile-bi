"use client";

import { useEffect, useMemo } from "react";
import { usePlanStore } from "@/stores/planStore";
import { planVirtualFields, type PlanProjectPickOptions, type VirtualField } from "@/lib/plan";
import type { CalculatedField, PlanContext, PlanProject } from "@/lib/types";

export interface DatasetPlan {
  project: PlanProject | undefined;
  /** То, что уходит в `/api/query` как `plan`. `undefined` — у датасета нет плана. */
  planCtx: PlanContext | undefined;
  /** Виртуальные поля группы «План» (по 5 на поле плана). */
  virtualFields: VirtualField[];
  /**
   * Те же поля как «псевдо-вычисляемые» — только для отображения в сводной
   * (формат ₽/$/% у ячеек). На сервер не уходят.
   */
  displayFields: CalculatedField[];
}

/**
 * План-проект датасета для конструктора и виджетов: подгружает проекты
 * и отдаёт контекст плана для запроса. `opts.demoObject` — демо-дашборд или
 * демо-график: им всегда нужен демо-план, а не свой проект на демо-датасете.
 * `opts.projectId` — проект, из которого собран объект (`config.planProjectId`):
 * на датасете может быть несколько проектов, и график считает по своему.
 */
export function usePlanForDataset(
  datasetId: string | undefined,
  opts: PlanProjectPickOptions = {},
): DatasetPlan {
  const demoObject = Boolean(opts.demoObject);
  const projectId = opts.projectId;
  const load = usePlanStore((s) => s.load);
  // Подписка на projects — чтобы пересчитаться после загрузки/правки плана.
  const projects = usePlanStore((s) => s.projects);
  const projectForDataset = usePlanStore((s) => s.projectForDataset);

  useEffect(() => {
    // load() идемпотентен (повторный вызов при загруженных/грузящихся проектах
    // ничего не делает), поэтому зовём его из каждого виджета без своей защиты.
    // Ошибка загрузки не мешает графикам: демо-план остаётся в сторе.
    void load().catch(() => undefined);
  }, [load]);

  const project = useMemo(
    () => (datasetId ? projectForDataset(datasetId, { demoObject, projectId }) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [datasetId, demoObject, projectId, projects, projectForDataset],
  );

  return useMemo(() => {
    if (!project || project.fields.length === 0) {
      return { project, planCtx: undefined, virtualFields: [], displayFields: [] };
    }
    const virtualFields = planVirtualFields(project);
    return {
      project,
      planCtx: {
        dateColumn: project.dateColumn,
        fields: project.fields,
        values: project.values,
      },
      virtualFields,
      displayFields: virtualFields.map((v) => ({
        id: `plan:${v.name}`,
        name: v.name,
        formula: "",
        datasetType: "float" as const,
        format: v.format,
        description: v.description,
      })),
    };
  }, [project]);
}
