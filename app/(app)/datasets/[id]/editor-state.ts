import type { DataSource, Dataset } from "@/lib/types";

export type DatasetEditorView =
  | { state: "new" }
  | { state: "loading" }
  | { state: "not_found" }
  | { state: "error"; message: string }
  | { state: "edit"; dataset: Dataset };

/**
 * Что показывать на `/datasets/[id]`. Форма редактора заполняется один раз
 * при монтировании, поэтому монтировать её можно только когда известен сам
 * датасет и его источник: иначе при прямом заходе / перезагрузке форма
 * заполнилась бы значениями по умолчанию (демо-источник, пустое название),
 * и «Сохранить» перезаписал бы датасет.
 */
export function datasetEditorView(input: {
  id: string;
  datasets: Dataset[];
  datasetsLoaded: boolean;
  /** Ошибка загрузки датасетов: без успешной загрузки «не найден» говорить нельзя. */
  datasetsError?: string | null;
  sources: Pick<DataSource, "id">[];
  sourcesLoaded: boolean;
}): DatasetEditorView {
  if (input.id === "new") return { state: "new" };
  const dataset = input.datasets.find((d) => d.id === input.id);
  if (!dataset) {
    if (!input.datasetsLoaded) return { state: "loading" };
    if (input.datasetsError) return { state: "error", message: input.datasetsError };
    return { state: "not_found" };
  }
  const sourceKnown = input.sources.some((s) => s.id === dataset.dataSourceId);
  // Источник удалён — после загрузки всё равно открываем: пользователь выберет новый.
  if (!sourceKnown && !input.sourcesLoaded) return { state: "loading" };
  return { state: "edit", dataset };
}
