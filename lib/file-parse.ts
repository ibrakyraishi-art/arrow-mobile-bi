import type { DatasetColumnType, QueryResultRow } from "@/lib/types";
import { FILE_MAX_ROWS, FILE_MAX_COLS } from "@/lib/file-constants";

export { FILE_MAX_ROWS };

export interface ParsedColumn {
  name: string;
  type: DatasetColumnType;
}

export interface ParsedFile {
  columns: ParsedColumn[];
  rows: QueryResultRow[];
  /** true — данные обрезаны до FILE_MAX_ROWS. */
  truncated: boolean;
}

/** Уникализация и заполнение пустых заголовков. */
function normalizeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = String(h ?? "").trim();
    if (!name) name = `col_${i + 1}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}_${count + 1}`;
  });
}

/** Парсит число с учётом RU/US-форматов (пробелы-разряды, запятая-десятичная). */
function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/\s| /g, "");
  if (s === "") return null;
  let norm = s;
  // EU-тысячи с точкой-разделителем (1.234.567 / 1.234,56) трактуем как тысячи
  // ТОЛЬКО при ≥2 группах ИЛИ при явной десятичной запятой. Одиночное «1.234»
  // (≤3 цифры . 3 цифры, без запятой) — это ДЕСЯТИЧНАЯ дробь 1.234, а не 1234
  // (иначе колонки вроде ROAS/долей молча портятся: 1.234→1234, 0.987→987).
  if (
    /^-?\d{1,3}(\.\d{3}){2,}(,\d+)?$/.test(s) ||
    /^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)
  ) {
    norm = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    norm = s.replace(/,/g, ""); // US: 1,234.56 / 1,234,567
  } else if (/^-?\d+,\d+$/.test(s)) {
    norm = s.replace(",", "."); // десятичная запятая: 1,5 → 1.5
  }
  if (!/^-?\d*\.?\d+$/.test(norm)) return null;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

// Распознаём распространённые форматы дат (не только два): ISO ГГГГ-ММ-ДД и
// ГГГГ/ММ/ДД; ДД.ММ.ГГГГ / ДД/ММ/ГГГГ / ДД-ММ-ГГГГ (день и месяц 1–2 цифры);
// а также 2-значный год ДД.ММ.ГГ. Разделитель между группами — единый
// (`[-/.]` с обратной ссылкой), чтобы не ловить «мусор» вроде 1.2-3.
const DATE_RE =
  /^\d{4}([-/.])\d{1,2}\1\d{1,2}$|^\d{1,2}([./-])\d{1,2}\2\d{4}$|^\d{1,2}([./-])\d{1,2}\3\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;
const BOOL_VALUES = new Set(["true", "false", "да", "нет", "yes", "no"]);

/**
 * Определяет тип столбца по выборке значений и приводит числовые столбцы к
 * number прямо в строках. Пустые ячейки → null.
 */
function inferAndCoerce(
  headers: string[],
  rows: Record<string, string>[],
): { columns: ParsedColumn[]; rows: QueryResultRow[] } {
  const columns: ParsedColumn[] = headers.map((name) => {
    const values = rows
      .map((r) => (r[name] ?? "").trim())
      .filter((v) => v !== "");
    // Полностью пустую колонку трактуем как ЧИСЛОВУЮ (integer): в аналитике это
    // обычно метрика, которую ещё не заполнили. Так она попадает в «Метрики»
    // (а не прячется как «текст»); значения будут 0/пусто, пока не зальют данные.
    if (values.length === 0) return { name, type: "integer" };

    const allInt = values.every((v) => {
      const n = parseNumber(v);
      return n !== null && Number.isInteger(n);
    });
    const allNum = values.every((v) => parseNumber(v) !== null);
    const allBool = values.every((v) => BOOL_VALUES.has(v.toLowerCase()));
    const allDateTime = values.every((v) => DATETIME_RE.test(v));
    const allDate = values.every((v) => DATE_RE.test(v));

    let type: DatasetColumnType;
    if (allBool) type = "boolean";
    else if (allDateTime) type = "datetime";
    else if (allDate) type = "date";
    else if (allInt) type = "integer";
    else if (allNum) type = "float";
    else {
      const distinct = new Set(values).size;
      type = distinct <= Math.max(20, values.length * 0.5) && distinct < 100
        ? "category"
        : "string";
    }
    return { name, type };
  });

  const numericCols = new Set(
    columns.filter((c) => c.type === "integer" || c.type === "float").map((c) => c.name),
  );

  const outRows: QueryResultRow[] = rows.map((r) => {
    const o: QueryResultRow = {};
    for (const { name } of columns) {
      const raw = (r[name] ?? "").trim();
      if (raw === "") {
        o[name] = null;
      } else if (numericCols.has(name)) {
        o[name] = parseNumber(raw);
      } else {
        o[name] = raw;
      }
    }
    return o;
  });

  return { columns, rows: outRows };
}

/**
 * Из «сырой» матрицы (первая строка — заголовки) делает ParsedFile.
 * `maxRows` — лимит строк данных; `0`/`Infinity` = без лимита (живой режим
 * Google Sheets, где данные не хранятся в БД).
 */
function fromMatrix(matrix: string[][], maxRows: number = FILE_MAX_ROWS): ParsedFile {
  const nonEmpty = matrix.filter((row) => row.some((c) => String(c ?? "").trim() !== ""));
  if (nonEmpty.length === 0) {
    throw new Error("Файл пустой или не содержит данных.");
  }
  const headers = normalizeHeaders(nonEmpty[0].map((h) => String(h ?? "")));
  if (headers.length > FILE_MAX_COLS) {
    throw new Error(
      `Слишком много столбцов: ${headers.length}. Максимум — ${FILE_MAX_COLS}. ` +
        `Оставьте нужные колонки и загрузите снова.`,
    );
  }
  const dataRows = nonEmpty.slice(1);
  const capped = maxRows > 0 && Number.isFinite(maxRows);
  const truncated = capped && dataRows.length > maxRows;
  const limited = capped ? dataRows.slice(0, maxRows) : dataRows;
  const objs = limited.map((row) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      o[h] = String(row[i] ?? "");
    });
    return o;
  });
  if (objs.length === 0) {
    throw new Error("В файле есть заголовки, но нет строк с данными.");
  }
  const { columns, rows } = inferAndCoerce(headers, objs);
  return { columns, rows, truncated };
}

/** Удаляет ведущий BOM (U+FEFF) — иначе он прилипает к первому заголовку. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Декодирует байты CSV-файла в строку с автоопределением кодировки: сначала
 * строгий UTF-8; при невалидных последовательностях (типично для выгрузок в
 * Windows-1251 из 1С/Excel) — повтор в windows-1251. BOM удаляется.
 */
export function decodeCsvBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  try {
    return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    try {
      return stripBom(new TextDecoder("windows-1251").decode(bytes));
    } catch {
      return stripBom(new TextDecoder("utf-8").decode(bytes));
    }
  }
}

/** CSV-файл (как байты) → ParsedFile, с автоопределением кодировки. */
export async function parseCsvBuffer(
  buf: ArrayBuffer,
  maxRows: number = FILE_MAX_ROWS,
): Promise<ParsedFile> {
  return parseCsvText(decodeCsvBuffer(buf), maxRows);
}

/**
 * CSV/текст → ParsedFile (PapaParse, автоопределение разделителя `,`/`;`/таб).
 * `maxRows` — лимит строк (`0`/`Infinity` = без лимита, для живого режима).
 */
export async function parseCsvText(
  text: string,
  maxRows: number = FILE_MAX_ROWS,
): Promise<ParsedFile> {
  const Papa = (await import("papaparse")).default;
  const res = Papa.parse<string[]>(stripBom(text), {
    header: false,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });
  if (res.errors?.length) {
    const fatal = res.errors.find((e) => e.type === "Delimiter" || e.code === "UndetectableDelimiter");
    if (fatal) throw new Error("Не удалось определить разделитель CSV. Проверьте файл.");
  }
  return fromMatrix(res.data as string[][], maxRows);
}

/**
 * Значение ячейки ExcelJS → строка. Покрывает «сложные» типы ExcelJS, которые
 * иначе сериализовались бы в "[object Object]":
 *  - дата → ISO (YYYY-MM-DD);
 *  - формула `{ formula, result }` → её ВЫЧИСЛЕННОЕ значение;
 *  - rich text `{ richText: [...] }` → склейка фрагментов;
 *  - гиперссылка `{ text, hyperlink }` → видимый текст;
 *  - ошибка `{ error: '#DIV/0!' }` → текст ошибки.
 */
function excelCellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text; // гиперссылка / простой текст
    if (Array.isArray(o.richText)) {
      return o.richText
        .map((r) =>
          r && typeof r === "object" && "text" in r
            ? String((r as { text: unknown }).text ?? "")
            : "",
        )
        .join("");
    }
    if ("result" in o) {
      const r = o.result;
      if (r instanceof Date) return r.toISOString().slice(0, 10);
      if (r === null || r === undefined || typeof r === "object") return "";
      return String(r);
    }
    if (typeof o.error === "string") return o.error;
    return "";
  }
  return String(v);
}

export interface ParsedWorkbook extends ParsedFile {
  /** Имена всех вкладок (листов) книги. */
  tabs: string[];
  /** Имя фактически разобранного листа. */
  sheetName: string;
}

/**
 * Excel/xlsx → ParsedFile + список вкладок. `sheetName` (если задан и есть в
 * книге) выбирает лист, иначе берётся первый. `maxRows` — лимит строк
 * (`0`/`Infinity` = без лимита, для живого режима Google Sheets).
 */
export async function parseExcelWithTabs(
  buf: ArrayBuffer,
  opts?: { sheetName?: string; maxRows?: number },
): Promise<ParsedWorkbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const tabs = wb.worksheets.map((w) => w.name);
  if (tabs.length === 0) throw new Error("В таблице нет листов.");
  const ws =
    (opts?.sheetName ? wb.getWorksheet(opts.sheetName) : undefined) ??
    wb.worksheets[0];
  if (!ws) throw new Error("В таблице нет листов.");
  const matrix: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = row.values as unknown[]; // 1-indexed; [0] пустой
    const cells: string[] = [];
    for (let i = 1; i < vals.length; i++) {
      cells.push(excelCellToString(vals[i]));
    }
    matrix.push(cells);
  });
  const parsed = fromMatrix(matrix, opts?.maxRows ?? FILE_MAX_ROWS);
  return { ...parsed, tabs, sheetName: ws.name };
}

/** Excel (.xlsx) → ParsedFile (первый/указанный лист, опц. лимит строк). */
export async function parseExcelArrayBuffer(
  buf: ArrayBuffer,
  opts?: { sheetName?: string; maxRows?: number },
): Promise<ParsedFile> {
  const { columns, rows, truncated } = await parseExcelWithTabs(buf, opts);
  return { columns, rows, truncated };
}
