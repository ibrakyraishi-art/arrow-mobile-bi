import type {
  AggregationType,
  Dataset,
  DashboardSheet,
  DashboardWidget,
  DashboardWidgetWidth,
  PivotValueConfig,
  PlanField,
  PlanProject,
  Visualization,
  VisualizationConfig,
  VisualizationType,
} from "../types";
import { CURRENT_MONTH_PERIOD } from "./period";
import { planColumnName } from "./fields";
import type { BuildPlanDashboardOptions, DashboardDraft } from "./types";

/**
 * Шаблон дашборда план/факт (Решения §10). Чистая функция: возвращает
 * черновик с временными id — его сохраняет кнопка «Собрать дашборд», а демо
 * сидит как есть (с `idPrefix`).
 *
 * Лист «План/факт»:
 *  - на каждое поле — метрика `· выполнение %` (third, светофор) с подписью
 *    (`config.caption`): прогноз для «объёма», план для «ставки»;
 *  - progress: выполнение всех полей, полоса на поле;
 *  - на каждое поле «объём» — combo по дате: столбцы факт, линия `· план`;
 *  - сводная: план, план на дату, факт, выполнение %, отклонение по всем полям
 *    (итог за период фильтра; фильтр «Период» по умолчанию — текущий месяц).
 * `opts.breakdownColumn` (одна колонка или несколько) → лист «Разрезы»: на
 * колонку сводная `<колонка> → факт` по полям-объёмам, столбчатый график факта
 * главного поля-объёма и круговая «доля в факте». Без `· выполнение %` и без
 * светофора: план общий на проект (история 30, D03), выполнение «к общему
 * плану» в разрезе вводило бы в заблуждение.
 * Подписи — человеческие названия колонок (`datasetColumnLabel`).
 */
/** Имя дашборда-шаблона план/факт проекта — одно на приложение (сборка, поиск собранного). */
export function planDashboardName(project: Pick<PlanProject, "name">): string {
  return `План/факт: ${project.name}`;
}

/**
 * Человеческое название колонки для подписей: словарь `labels`, иначе
 * описание колонки датасета (до первого «—», «.», «(» или «,»), иначе имя колонки.
 */
export function datasetColumnLabel(
  dataset: Pick<Dataset, "columns">,
  column: string,
  labels?: Record<string, string>,
): string {
  const fromDict = labels?.[column]?.trim();
  if (fromDict) return fromDict;
  const desc = (dataset.columns ?? []).find((c) => c.name === column)?.description ?? "";
  const short = desc.split(/\s—\s|[.(,]/)[0]?.trim() ?? "";
  return short && short.length <= 40 ? short : column;
}

export function buildPlanDashboard(
  project: Pick<PlanProject, "id" | "name" | "dateColumn" | "fields">,
  dataset: Pick<Dataset, "id" | "columns" | "calculatedFields">,
  opts: BuildPlanDashboardOptions = {},
): DashboardDraft {
  const prefix = opts.idPrefix ?? "draft-";
  const now = opts.now ?? new Date();
  const createdAt = now.toISOString();
  const draftId = `${prefix}dashboard`;
  const fields = [...project.fields].sort((a, b) => a.sortOrder - b.sortOrder);
  const calcNames = new Set((dataset.calculatedFields ?? []).map((c) => c.name));
  const columnNames = new Set((dataset.columns ?? []).map((c) => c.name));

  let seq = 0;
  const nextId = (kind: string) => `${prefix}${kind}-${++seq}`;
  const visualizations: Visualization[] = [];

  const sum = (column: string): PivotValueConfig => ({ column, aggregation: "SUM" });
  const factValue = (f: PlanField): PivotValueConfig => {
    // Вычисляемые поля считаются по агрегатам сами; сырую колонку-ставку усредняем.
    const aggregation: AggregationType =
      f.kind === "rate" && !calcNames.has(f.sourceColumn) ? "AVG" : "SUM";
    return { column: f.sourceColumn, aggregation };
  };
  const completionCol = (f: PlanField) => planColumnName(f.label, "completion");

  const addViz = (
    name: string,
    type: VisualizationType,
    config: Partial<VisualizationConfig>,
  ): Visualization => {
    const viz: Visualization = {
      id: nextId("viz"),
      name,
      datasetId: dataset.id,
      type,
      // id проекта — чтобы график считал план именно этого проекта (Т09).
      config: { rows: [], columns: [], values: [], filters: [], ...config, planProjectId: project.id },
      createdAt,
    };
    visualizations.push(viz);
    return viz;
  };

  const makeSheet = (name: string, sortOrder: number) => {
    const sheet: DashboardSheet = {
      id: nextId("sheet"),
      dashboardId: draftId,
      name,
      sortOrder,
      widgets: [],
    };
    const push = (w: Omit<DashboardWidget, "id" | "sheetId" | "sortOrder">) => {
      sheet.widgets.push({
        ...w,
        id: nextId("w"),
        sheetId: sheet.id,
        sortOrder: sheet.widgets.length,
      });
    };
    const vizWidget = (viz: Visualization, width: DashboardWidgetWidth) =>
      push({
        widgetType: viz.type === "pivot" ? "pivot" : "chart",
        visualizationId: viz.id,
        title: viz.name,
        config: {},
        width,
      });
    return { sheet, push, vizWidget };
  };

  // --- Лист «План/факт» ------------------------------------------------------
  const main = makeSheet("План/факт", 0);

  for (const f of fields) {
    const isVolume = f.kind === "volume";
    main.push({
      widgetType: "metric",
      title: `${f.label}: выполнение`,
      config: {
        column: completionCol(f),
        aggregation: "SUM",
        format: "percent",
        // Подпись под цифрой; светофор — по направлению поля.
        caption: {
          column: planColumnName(f.label, isVolume ? "forecast" : "plan"),
          aggregation: "SUM",
          label: isVolume ? "Прогноз на конец месяца" : "План",
          format: f.format ?? "number",
        },
        plan: { fieldId: f.id, virtualKind: "completion", direction: f.direction },
        planProjectId: project.id,
      },
      width: "third",
    });
  }

  if (fields.length > 0) {
    const progress = addViz("Выполнение плана по полям", "progress", {
      values: fields.map((f) => sum(completionCol(f))),
    });
    main.vizWidget(progress, "full");
  }

  for (const f of fields.filter((x) => x.kind === "volume")) {
    const fact = factValue(f);
    const combo = addViz(`${f.label} по дням: факт vs план`, "combo", {
      xAxis: project.dateColumn,
      yAxis: fact,
      values: [fact, sum(planColumnName(f.label, "plan"))],
    });
    main.vizWidget(combo, "full");
  }

  if (fields.length > 0) {
    const values: PivotValueConfig[] = [];
    for (const f of fields) {
      values.push(
        sum(planColumnName(f.label, "plan")),
        sum(planColumnName(f.label, "planToDate")),
        factValue(f),
        sum(completionCol(f)),
        sum(planColumnName(f.label, "deviation")),
      );
    }
    const pivot = addViz("План / факт за месяц", "pivot", { values });
    main.vizWidget(pivot, "full");
  }

  const sheets: DashboardSheet[] = [main.sheet];

  // --- Лист «Разрезы» --------------------------------------------------------
  const rawBreakdown = opts.breakdownColumn;
  const breakdown = Array.from(
    new Set(Array.isArray(rawBreakdown) ? rawBreakdown : rawBreakdown ? [rawBreakdown] : []),
  ).filter((c) => columnNames.has(c) && c !== project.dateColumn);
  // В разрезе — только факт полей-объёмов (их можно складывать и делить на доли).
  const volumes = fields.filter((f) => f.kind === "volume");
  const mainVolume = volumes[0];
  if (breakdown.length > 0 && mainVolume) {
    const cuts = makeSheet("Разрезы", 1);
    for (const col of breakdown) {
      const label = datasetColumnLabel(dataset, col);
      const pivot = addViz(`${label}: факт по полям плана`, "pivot", {
        rows: [col],
        values: volumes.map(factValue),
      });
      cuts.vizWidget(pivot, "full");
      const fact = factValue(mainVolume);
      const bar = addViz(`${mainVolume.label}: факт по разрезу «${label}»`, "bar", {
        xAxis: col,
        yAxis: fact,
        values: [fact],
      });
      cuts.vizWidget(bar, "half");
      const share = addViz(`${mainVolume.label}: доля в факте по разрезу «${label}»`, "pie", {
        xAxis: col,
        yAxis: fact,
        values: [fact],
      });
      cuts.vizWidget(share, "half");
    }
    sheets.push(cuts.sheet);
  }

  return {
    draftId,
    name: opts.name ?? planDashboardName(project),
    description:
      "Выполнение плана: темп с начала месяца, прогноз на конец месяца, факт против плана по дням.",
    datasetId: dataset.id,
    filtersConfig: [
      {
        id: `${prefix}filter-period`,
        column: project.dateColumn,
        label: "Период",
        type: "date_range",
        // Относительный дефолт: «текущий месяц» на момент открытия дашборда.
        defaultValue: CURRENT_MONTH_PERIOD,
      },
    ],
    visualizations,
    sheets,
  };
}
