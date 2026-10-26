-- 019: режим файлового источника (снимок/живой) + отметка последнего обновления.
-- Применено к prod через MCP; здесь для воспроизводимости. Идемпотентно.
--
-- mode:
--   'snapshot' — строки хранятся в file_sources.rows (как раньше, лимит 5000);
--                для Google Sheets автообновляются раз в 30 мин + по кнопке.
--   'live'     — строки НЕ хранятся (rows=[]), тянутся по ссылке при КАЖДОМ
--                запросе, без лимита строк (только защита по размеру выгрузки).
-- last_refreshed_at — когда снимок последний раз тянулся из таблицы (для
--                ленивого автообновления раз в 30 мин и отображения в UI).

ALTER TABLE public.file_sources
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'snapshot';
ALTER TABLE public.file_sources
  ADD COLUMN IF NOT EXISTS last_refreshed_at timestamptz;

NOTIFY pgrst, 'reload schema';
