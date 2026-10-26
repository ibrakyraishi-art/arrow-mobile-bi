import type {
  AggregationType,
  CalculatedFieldFormat,
  DashboardFilter,
  DashboardSheet,
  PlanDirection,
  PlanKind,
  PlanVirtualKind,
  QueryResultRow,
  Visualization,
} from "../types";

/** Строка результата запроса. */
export type Row = QueryResultRow;

/**
 * Группа результата запроса, которую нужно дозаполнить полями плана.
 * Собирает движок `/api/query` (in-JS из строк, ClickHouse — вторичным запросом дат).
 */
export interface PlanGroup {
  /** Строка группы как есть: ключи измерений + уже посчитанные значения. Копируется в выход. */
  row: Row;
  /** Факт по каждому `sourceColumn` полей плана (агрегат группы). Нет ключа/`null` = нет факта. */
  facts: Record<string, number | null>;
  /** Даты группы, где есть данные (`YYYY-MM-DD` или дата-время — берётся дата). */
  dates: string[];
  /**
   * Группировка идёт по дню (одна дата на группу) → «· план» = дневной план.
   * Только явное `true`; иначе «· план» = полный план месяцев, которых касается группа.
   */
  groupedByDate?: boolean;
  /**
   * Факт группы по дням: `{ "YYYY-MM-DD": { [sourceColumn]: число } }`.
   * Нужен «объёмам»: если часть дат группы приходится на месяцы без плана,
   * выполнение, прогноз и отклонение считаются по факту только тех дат, на
   * которые план есть. Нет поля (`undefined`) — факт группы берётся целиком
   * (как раньше). `null` — факт по дням нужен, но неизвестен (группы нет в
   * ответе, запрос дат обрезан): выполнение/прогноз/отклонение объёма = `null`.
   */
  factsByDate?: Record<string, Record<string, number | null>> | null;
}

/** Виртуальная метрика плана — выбирается в конструкторе как обычное поле датасета. */
export interface VirtualField {
  /** Имя колонки: `«<подпись> · план»`, `· план на дату`, `· выполнение %`, `· прогноз`, `· отклонение`. */
  name: string;
  fieldId: string;
  /** Подпись поля плана. */
  label: string;
  virtualKind: PlanVirtualKind;
  sourceColumn: string;
  kind: PlanKind;
  direction: PlanDirection;
  datasetType: "float";
  /** Формат значения: у `· выполнение %` всегда `percent` (значение в процентах, 88 = 88%). */
  format?: CalculatedFieldFormat;
  /** Агрегация по умолчанию для конструктора (сервер её игнорирует — значение считает план). */
  aggregation: AggregationType;
  /** Подсказка для UI. */
  description: string;
}

/**
 * Черновик дашборда план/факт. Все id временные (с префиксом `opts.idPrefix`);
 * виджеты ссылаются на визуализации черновика по `visualizationId`.
 * Сохранение: создать визуализации → дашборд → листы → виджеты с заменой id.
 */
export interface DashboardDraft {
  name: string;
  description: string;
  datasetId: string;
  filtersConfig: DashboardFilter[];
  visualizations: Visualization[];
  /** `dashboardId` у листов — временный id черновика (`draftId`). */
  sheets: DashboardSheet[];
  draftId: string;
}

export interface BuildPlanDashboardOptions {
  /** Колонка-разрез (или несколько) → лист «Разрезы». Колонки, которых нет в датасете, пропускаются. */
  breakdownColumn?: string | string[];
  /** Префикс временных id. По умолчанию `draft-`. */
  idPrefix?: string;
  /** Имя дашборда. По умолчанию `План/факт: <имя проекта>`. */
  name?: string;
  /** «Сейчас» — для createdAt и периода фильтра по умолчанию (текущий месяц по Москве). */
  now?: Date;
}
