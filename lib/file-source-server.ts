import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ColumnInfo, QueryResultRow } from "@/lib/types";
import { parseCsvText, parseExcelArrayBuffer } from "@/lib/file-parse";
import { fetchSheetCsv, fetchSheetXlsx } from "@/lib/google-sheet-server";
import { decrypt } from "@/lib/encryption";

import { FILE_TABLE, FILE_MAX_ROWS, FILE_MAX_COLS } from "@/lib/file-constants";
export { FILE_TABLE, FILE_MAX_ROWS, FILE_MAX_COLS };

export interface LoadedFileSource {
  format: string;
  columns: ColumnInfo[];
  rows: QueryResultRow[];
}

/** TTL эфемерного кэша скачанного листа: дедуп параллельных плиток дашборда +
 *  защита от тротлинга Google. Живёт в памяти инстанса, не персистится. */
const SHEET_CACHE_TTL_MS = 30_000; // 30 секунд

interface FetchedSheet {
  columns: { name: string; type: string }[];
  rows: QueryResultRow[];
}

interface SheetMeta {
  sheetUrl: string;
  /** Имя выбранной вкладки (если задано — читаем книгу xlsx по имени листа). */
  sheetName?: string;
}

function metaOf(meta: unknown): SheetMeta {
  if (meta && typeof meta === "object") {
    const m = meta as {
      sheetUrl?: unknown;
      sheetUrlEnc?: unknown;
      sheetName?: unknown;
    };
    // Новые источники хранят ЗАШИФРОВАННУЮ ссылку (sheetUrlEnc) — расшифровываем
    // на сервере. Старые источники с открытой ссылкой (sheetUrl) — фолбэк.
    let sheetUrl = "";
    if (typeof m.sheetUrlEnc === "string" && m.sheetUrlEnc) {
      try {
        sheetUrl = decrypt(m.sheetUrlEnc);
      } catch {
        sheetUrl = "";
      }
    } else if (typeof m.sheetUrl === "string") {
      sheetUrl = m.sheetUrl;
    }
    return {
      sheetUrl,
      sheetName:
        typeof m.sheetName === "string" && m.sheetName ? m.sheetName : undefined,
    };
  }
  return { sheetUrl: "" };
}

/**
 * Скачивает и парсит данные таблицы. Если выбрана вкладка (sheetName) — читаем
 * всю книгу как xlsx и берём лист по имени; иначе — CSV-выгрузку (первый/указанный
 * в ссылке лист). `maxRows=0/Infinity` — без лимита (живой режим).
 */
async function loadSheetData(
  meta: SheetMeta,
  maxRows: number,
): Promise<FetchedSheet | null> {
  if (!meta.sheetUrl) return null;
  if (meta.sheetName) {
    const x = await fetchSheetXlsx(meta.sheetUrl);
    if (!x.ok) return null;
    try {
      const p = await parseExcelArrayBuffer(x.buf, {
        sheetName: meta.sheetName,
        maxRows,
      });
      return { columns: p.columns, rows: p.rows };
    } catch {
      return null;
    }
  }
  const c = await fetchSheetCsv(meta.sheetUrl);
  if (!c.ok) return null;
  try {
    const p = await parseCsvText(c.csv, maxRows);
    return { columns: p.columns, rows: p.rows };
  } catch {
    return null;
  }
}

interface CacheEntry {
  at: number;
  promise: Promise<FetchedSheet | null>;
}
const sheetCache = new Map<string, CacheEntry>();

/** Кэш скачивания листа по id источника: дедуп «в полёте» + TTL. */
function getCachedSheet(
  dataSourceId: string,
  meta: SheetMeta,
  maxRows: number,
): Promise<FetchedSheet | null> {
  const hit = sheetCache.get(dataSourceId);
  if (hit && Date.now() - hit.at < SHEET_CACHE_TTL_MS) return hit.promise;
  const promise = loadSheetData(meta, maxRows);
  sheetCache.set(dataSourceId, { at: Date.now(), promise });
  // Неуспех не кэшируем надолго — снимаем запись, чтобы повторили запрос.
  void promise.then((v) => {
    if (v === null && sheetCache.get(dataSourceId)?.promise === promise) {
      sheetCache.delete(dataSourceId);
    }
  });
  return promise;
}

/**
 * Загружает строки файлового источника. Возвращает null, если это не файловый
 * источник (нет строки в file_sources) — тогда вызывающий код идёт по ветке
 * ClickHouse. RLS гарантирует доступ только к своим источникам.
 *
 * Режимы (только Google Sheets):
 *  - 'live'     — строки НЕ хранятся в БД: тянем по ссылке при каждом запросе
 *                 (без лимита строк), кэш ~30 сек от перегрузки Google.
 *  - 'snapshot' — строки хранятся в file_sources.rows (лимит 5000). Обновление
 *                 ТОЛЬКО ручное (кнопка «Обновить») — авто-обновления нет.
 * Загруженные CSV/Excel живого источника не имеют — всегда из снимка.
 */
export async function loadFileSource(
  supabase: SupabaseClient,
  dataSourceId: string,
): Promise<LoadedFileSource | null> {
  const { data, error } = await supabase
    .from("file_sources")
    .select("format, columns, rows, mode, source_meta")
    .eq("data_source_id", dataSourceId)
    .maybeSingle();
  if (error || !data) return null;

  const format = (data.format as string) ?? "csv";
  const columns: ColumnInfo[] = Array.isArray(data.columns)
    ? (data.columns as ColumnInfo[])
    : [];
  const storedRows: QueryResultRow[] = Array.isArray(data.rows)
    ? (data.rows as QueryResultRow[])
    : [];
  const mode = data.mode === "live" ? "live" : "snapshot";
  const meta = metaOf(data.source_meta);
  const canFetch = format === "gsheet" && !!meta.sheetUrl;

  // Живой режим: всегда тянем по ссылке (кэш дедуплицирует), без лимита строк.
  if (mode === "live" && canFetch) {
    const fresh = await getCachedSheet(dataSourceId, meta, Infinity);
    if (!fresh) {
      // Не удалось скачать — отдаём известную схему с пустыми строками,
      // вызывающий код покажет «нет данных», а не упадёт.
      return { format, columns, rows: [] };
    }
    return {
      format,
      columns: columns.length > 0 ? columns : (fresh.columns as ColumnInfo[]),
      rows: fresh.rows,
    };
  }

  // Снимок: данные берём из БД. Обновление — только вручную (кнопка «Обновить»).
  return { format, columns, rows: storedRows };
}

export type RefreshResult =
  | { ok: true; mode: string; rowCount: number; lastRefreshedAt: string | null }
  | { ok: false; error: string; status: number };

/**
 * Принудительно обновляет источник из Google Sheets (кнопка «Обновить»).
 * Снимок — перекачиваем и пишем в БД (лимит 5000). Живой — сбрасываем кэш и
 * прогреваем его свежими данными (в БД ничего не пишем).
 */
export async function refreshFileSource(
  supabase: SupabaseClient,
  dataSourceId: string,
): Promise<RefreshResult> {
  const { data, error } = await supabase
    .from("file_sources")
    .select("format, mode, source_meta")
    .eq("data_source_id", dataSourceId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, status: 404, error: "Источник не найден" };
  }
  const format = (data.format as string) ?? "csv";
  const mode = data.mode === "live" ? "live" : "snapshot";
  const meta = metaOf(data.source_meta);
  if (format !== "gsheet" || !meta.sheetUrl) {
    return {
      ok: false,
      status: 400,
      error:
        "Обновление доступно только для Google Sheets. Загруженные файлы CSV/Excel обновить нельзя — создайте источник заново.",
    };
  }

  // Сбрасываем кэш и качаем заново.
  sheetCache.delete(dataSourceId);
  const fresh = await loadSheetData(meta, mode === "live" ? Infinity : FILE_MAX_ROWS);
  if (!fresh) {
    return {
      ok: false,
      status: 400,
      error:
        "Не удалось получить данные из таблицы. Проверьте доступ по ссылке (Просмотр для всех, у кого есть ссылка).",
    };
  }

  if (mode === "live") {
    sheetCache.set(dataSourceId, {
      at: Date.now(),
      promise: Promise.resolve(fresh),
    });
    return { ok: true, mode, rowCount: fresh.rows.length, lastRefreshedAt: null };
  }

  const nowIso = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("file_sources")
    .update({
      rows: fresh.rows,
      row_count: fresh.rows.length,
      last_refreshed_at: nowIso,
    })
    .eq("data_source_id", dataSourceId);
  if (upErr) {
    return { ok: false, status: 500, error: "Не удалось сохранить обновление" };
  }
  return { ok: true, mode, rowCount: fresh.rows.length, lastRefreshedAt: nowIso };
}
