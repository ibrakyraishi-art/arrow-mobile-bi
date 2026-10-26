/**
 * Константы файловых источников (client-safe — без `server-only`, чтобы
 * использовать и в браузере, и на сервере).
 */

/** Логическое имя «таблицы» файлового источника (всегда один лист). */
export const FILE_TABLE = "data";

/** Лимит строк — защита БД и стоимости AI-анализа. */
export const FILE_MAX_ROWS = 5000;

/** Лимит столбцов. */
export const FILE_MAX_COLS = 100;

/** Лимит размера файла (защита от OOM/зависания браузера при парсинге). */
export const FILE_MAX_SIZE_MB = 20;
export const FILE_MAX_SIZE_BYTES = FILE_MAX_SIZE_MB * 1024 * 1024;
