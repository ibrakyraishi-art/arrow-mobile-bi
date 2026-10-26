import { BRAND_NAME, BRAND_FILE_PREFIX } from "@/lib/brand";
import type { QueryResultRow } from "@/lib/types";

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface AnalysisXlsxOptions {
  /** Имя файла без расширения. */
  filename?: string;
  /** Текст-аналитика (markdown как есть — читается нормально). */
  analysisText: string;
  /** Запрос пользователя (опционально). */
  prompt?: string;
  /** Срез данных, который анализировался. */
  rows: QueryResultRow[];
  /** PNG-картинка графика (data URL) — опционально, добавляется отдельным листом. */
  chartPngDataUrl?: string | null;
}

/**
 * Собирает .xlsx из результата AI-анализа и скачивает его в браузере.
 * Листы: «Аналитика» (текст), «Данные» (таблица среза) и, если передан
 * график, «График» (картинка PNG). exceljs работает на клиенте (как и парсинг
 * xlsx в `lib/file-parse.ts`).
 */
export async function downloadAnalysisXlsx(
  opts: AnalysisXlsxOptions,
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND_NAME;
  wb.created = new Date();

  // Лист «Аналитика» — текст ответа AI.
  const sa = wb.addWorksheet("Аналитика");
  sa.getColumn(1).width = 110;
  if (opts.prompt && opts.prompt.trim()) {
    const ph = sa.addRow(["Запрос"]);
    ph.font = { bold: true };
    sa.addRow([opts.prompt.trim()]);
    sa.addRow([]);
  }
  const ah = sa.addRow(["Анализ"]);
  ah.font = { bold: true };
  for (const line of opts.analysisText.split("\n")) {
    sa.addRow([line]);
  }
  sa.eachRow((row) => {
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
  });

  // Лист «Данные» — таблица среза.
  if (opts.rows.length > 0) {
    const sd = wb.addWorksheet("Данные");
    const keys = Object.keys(opts.rows[0]);
    const header = sd.addRow(keys);
    header.font = { bold: true };
    for (const r of opts.rows) {
      sd.addRow(
        keys.map((k) => {
          const v = r[k];
          return v === null || v === undefined ? "" : (v as string | number);
        }),
      );
    }
    keys.forEach((_, i) => {
      sd.getColumn(i + 1).width = 18;
    });
  }

  // Лист «График» — если передана картинка (PNG data URL).
  if (opts.chartPngDataUrl) {
    const sg = wb.addWorksheet("График");
    const base64 = opts.chartPngDataUrl.includes(",")
      ? opts.chartPngDataUrl.split(",")[1]
      : opts.chartPngDataUrl;
    const imgId = wb.addImage({ base64, extension: "png" });
    sg.addImage(imgId, {
      tl: { col: 0, row: 0 },
      ext: { width: 760, height: 440 },
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${opts.filename || `${BRAND_FILE_PREFIX}-analysis-${stamp()}`}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
