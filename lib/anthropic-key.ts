/**
 * Санитизация API-ключа Claude перед использованием в HTTP-заголовке.
 *
 * Известный баг: иногда в `anthropic_api_key` (после расшифровки из Supabase
 * или после копипасты пользователя) попадают невидимые юникод-символы —
 * BOM (U+FEFF), zero-width space (U+200B), replacement character (U+FFFD,
 * при битой расшифровке) и т.п. Если такой ключ передать в заголовок
 * `x-api-key`, fetch() бросит:
 *   "Cannot convert argument to a ByteString because the character at
 *    index 0 has a value of 65533 which is greater than 255"
 * — потому что HTTP-заголовки принимают только ISO-8859-1 / ASCII.
 *
 * Все легитимные ключи Anthropic содержат только ASCII-печатные символы
 * (`sk-ant-…` + base64-подобные). Поэтому безопасно вычистить ВСЁ, что вне
 * `0x20..0x7E`.
 */
export function sanitizeAnthropicKey(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(/[^\x20-\x7E]/g, "");
}

/**
 * Возвращает санитизированный ключ или объект с ошибкой (с текстом,
 * пригодным для показа пользователю). Удобно вызывать из API-роутов.
 */
export function prepareAnthropicKey(
  raw: string | null | undefined,
): { ok: true; key: string } | { ok: false; error: string } {
  const cleaned = sanitizeAnthropicKey(raw);
  if (!cleaned) {
    return {
      ok: false,
      error:
        "API-ключ Claude пустой или содержит только недопустимые символы. " +
        "Откройте «Настройки» и введите ключ заново (без лишних пробелов / BOM).",
    };
  }
  return { ok: true, key: cleaned };
}
