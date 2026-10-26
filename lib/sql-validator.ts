/**
 * Утилиты валидации SQL-идентификаторов и текста запроса. Не заменяют
 * параметризацию (её всё равно нужно делать через quoteIdent / escapeSql),
 * но защищают от очевидных инъекций и опасных DDL/DML операций в местах,
 * где пользователь может прислать «свободный» SQL или имя таблицы / столбца.
 */

const TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
const COLUMN_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Имя таблицы: латинские буквы, цифры, подчёркивания, точка (database.table). */
export function validateTableName(name: string): boolean {
  if (!name || name.length > 128) return false;
  return TABLE_NAME_RE.test(name);
}

/** Имя столбца: латинские буквы, цифры, подчёркивания. */
export function validateColumnName(name: string): boolean {
  if (!name || name.length > 128) return false;
  return COLUMN_NAME_RE.test(name);
}

/**
 * Грубая, но эффективная защита: ищем явно опасные операции верхнего уровня.
 * Намеренно жадная — если поймали хотя бы один из этих ключевиков отдельным
 * словом, считаем запрос подозрительным и отклоняем.
 */
const DANGEROUS_KEYWORDS = [
  "DROP",
  "DELETE",
  "INSERT",
  "UPDATE",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "RENAME",
  "ATTACH",
  "DETACH",
  "OPTIMIZE",
];

export function containsDangerousSQL(query: string): boolean {
  if (!query) return false;
  // Удаляем строковые литералы и комментарии, чтобы не реагировать
  // на «DROP» внутри значения 'foo DROP bar'.
  const stripped = query
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const upper = stripped.toUpperCase();
  for (const kw of DANGEROUS_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(upper)) return true;
  }
  return false;
}

/** Жёсткий лимит на размер выборки (используется в /api/query). */
export const MAX_ROW_LIMIT = 10000;

/** Приводит limit к допустимому диапазону [1, MAX_ROW_LIMIT]. */
export function clampRowLimit(limit: number | undefined, fallback = 500): number {
  const n = Number(limit ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_ROW_LIMIT);
}
