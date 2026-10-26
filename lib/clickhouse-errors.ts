/**
 * Нормализация и человекочитаемые сообщения об ошибках ClickHouse (HTTP / fetch).
 */

export type FriendlyClickhouseOptions = {
  /** Имя таблицы — для сообщения о недостатке прав (497) */
  tableName?: string;
};

/** Таймаут HTTP-запроса к ClickHouse при получении структуры таблицы (DESCRIBE и т.п.). */
export const CLICKHOUSE_STRUCTURE_QUERY_TIMEOUT_MS = 30_000;

/**
 * Достаёт текст исключения из JSON-ответа ClickHouse по HTTP, если есть.
 */
export function normalizeClickhouseErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return raw;
  try {
    const j = JSON.parse(trimmed) as {
      exception?: string;
      message?: string;
    };
    if (typeof j.exception === "string" && j.exception.length > 0) {
      return j.exception;
    }
    if (typeof j.message === "string" && j.message.length > 0) {
      return j.message;
    }
  } catch {
    /* ignore */
  }
  return raw;
}

function isAccessDenied(msg: string): boolean {
  return /Code:\s*497\b/i.test(msg) || /ACCESS_DENIED/i.test(msg);
}

/**
 * Сообщения для toast / API.
 */
export function friendlyClickhouseError(
  raw: string,
  options: FriendlyClickhouseOptions = {},
): string {
  const tableName = options.tableName?.trim();
  const msg = normalizeClickhouseErrorMessage(raw);

  if (isAccessDenied(msg)) {
    const ref = tableName && tableName.length > 0 ? tableName : "таблицы";
    return `Недостаточно прав для чтения таблицы ${ref}. Обратитесь к администратору ClickHouse — нужен GRANT SELECT на таблицу.`;
  }

  if (/ETIMEDOUT|TIMEOUT/i.test(msg) || /aborted/i.test(msg)) {
    return "Превышено время ожидания. Таблица слишком большая или соединение медленное. Попробуйте другую таблицу или обратитесь к администратору.";
  }

  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(msg)) {
    return "Не удалось подключиться к ClickHouse: хост не найден. Проверьте адрес сервера.";
  }

  if (/ECONNREFUSED/i.test(msg)) {
    return "Не удалось подключиться к ClickHouse. Проверьте host и port в источнике данных.";
  }

  if (/ECONNRESET|fetch failed|network|TLS|certificate/i.test(msg)) {
    return "Не удалось подключиться к ClickHouse. Проверьте VPN, порт и SSL.";
  }

  if (/\b401\b|Unauthorized|Authentication failed/i.test(msg)) {
    return "Неверный логин или пароль ClickHouse. Проверьте источник данных.";
  }

  if (/\bDB::Exception\b|Code:\s*\d+/i.test(msg)) {
    return msg;
  }

  return `Ошибка ClickHouse: ${msg}`;
}
