import "server-only";

/** Максимальный размер выгрузки CSV из Google Sheets (защита от OOM). */
export const SHEET_MAX_BYTES = 8_000_000;

export type SheetFetchResult =
  | { ok: true; csv: string }
  | { ok: false; error: string; status: number };

/**
 * Из ссылки на Google Sheets строит URL CSV-выгрузки нужного листа.
 * Берём ТОЛЬКО id таблицы и gid листа из ссылки и собираем фиксированный
 * адрес docs.google.com — без обращения к произвольному URL (защита от SSRF).
 * Возвращает null, если ссылка не похожа на Google Sheets.
 */
export function buildSheetExportUrl(url: string): string | null {
  const idMatch = /\/spreadsheets\/d\/([a-zA-Z0-9\-_]+)/.exec(url ?? "");
  if (!idMatch) return null;
  const id = idMatch[1];
  const gidMatch = /[#&?]gid=(\d+)/.exec(url);
  const gid = gidMatch ? gidMatch[1] : "0";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

/**
 * Из ссылки строит URL выгрузки ВСЕЙ книги в xlsx (все вкладки). Используется,
 * чтобы перечислить листы и прочитать выбранный лист по имени (gid из ссылки не
 * нужен). gid игнорируется — xlsx всегда содержит все листы.
 */
export function buildSheetXlsxUrl(url: string): string | null {
  const idMatch = /\/spreadsheets\/d\/([a-zA-Z0-9\-_]+)/.exec(url ?? "");
  if (!idMatch) return null;
  return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=xlsx`;
}

export type SheetXlsxResult =
  | { ok: true; buf: ArrayBuffer }
  | { ok: false; error: string; status: number };

/**
 * Скачивает всю книгу Google Sheets как .xlsx (для выбора вкладки и чтения
 * листа по имени). Только docs.google.com (id из ссылки), без SSRF. Закрытый
 * по ссылке лист Google отдаёт как HTML логина — распознаём.
 */
export async function fetchSheetXlsx(url: string): Promise<SheetXlsxResult> {
  const xlsxUrl = buildSheetXlsxUrl(url);
  if (!xlsxUrl) {
    return {
      ok: false,
      status: 400,
      error:
        "Это не похоже на ссылку Google Sheets. Скопируйте ссылку из адресной строки таблицы.",
    };
  }
  let res: Response;
  try {
    res = await fetch(xlsxUrl, { redirect: "follow" });
  } catch (e) {
    return {
      ok: false,
      status: 502,
      error: `Не удалось обратиться к Google: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok || ct.includes("text/html")) {
    return {
      ok: false,
      status: 400,
      error:
        "Таблица недоступна. Откройте доступ: «Настройки доступа» → «Все, у кого есть ссылка» (Просмотр).",
    };
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > SHEET_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "Таблица слишком большая. Сократите данные.",
    };
  }
  return { ok: true, buf };
}

/**
 * Скачивает лист Google Sheets как CSV. Сервер обращается только к
 * docs.google.com (id из ссылки). Если лист закрыт по ссылке, Google отдаёт
 * HTML-страницу логина — распознаём это и отдаём понятную ошибку.
 */
export async function fetchSheetCsv(url: string): Promise<SheetFetchResult> {
  const exportUrl = buildSheetExportUrl(url);
  if (!exportUrl) {
    return {
      ok: false,
      status: 400,
      error:
        "Это не похоже на ссылку Google Sheets. Скопируйте ссылку из адресной строки таблицы.",
    };
  }

  let res: Response;
  try {
    res = await fetch(exportUrl, { redirect: "follow" });
  } catch (e) {
    return {
      ok: false,
      status: 502,
      error: `Не удалось обратиться к Google: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const text = await res.text();
  const ct = res.headers.get("content-type") ?? "";
  const looksLikeHtml =
    ct.includes("text/html") ||
    text.trimStart().toLowerCase().startsWith("<!doctype html") ||
    text.trimStart().toLowerCase().startsWith("<html");

  if (!res.ok || looksLikeHtml) {
    return {
      ok: false,
      status: 400,
      error:
        "Лист недоступен. В Google Sheets откройте доступ: «Настройки доступа» → «Все, у кого есть ссылка» (Просмотр), либо «Файл → Поделиться → Опубликовать в интернете».",
    };
  }

  if (text.length > SHEET_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "Таблица слишком большая. Сократите данные или загрузите файлом.",
    };
  }

  return { ok: true, csv: text };
}
