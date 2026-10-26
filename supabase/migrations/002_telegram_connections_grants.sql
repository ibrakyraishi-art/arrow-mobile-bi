-- Явные права на telegram_connections (если таблицу создавали вручную в SQL Editor,
-- иногда не хватает GRANT для роли authenticated — INSERT/SELECT падают с permission denied).
-- Идемпотентно: повторный GRANT безопасен.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.telegram_connections TO authenticated;
GRANT ALL ON TABLE public.telegram_connections TO service_role;
