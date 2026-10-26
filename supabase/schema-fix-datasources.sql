-- ============================================================================
-- AI GoMobile — миграция таблицы data_sources до полной схемы.
--
-- Выполнить ОДИН РАЗ в SQL Editor проекта Supabase
-- (Dashboard → SQL Editor → New query → вставить содержимое → Run).
--
-- Скрипт идемпотентный: безопасно запускать повторно, ничего не сломает.
--
-- Что делает:
--   1) Добавляет колонку `updated_at` (если её ещё нет).
--      Используется приложением для трекинга «когда последний раз
--      обновляли подключение». UPDATE в lib/supabase-db.ts теперь всегда
--      пишет это поле, поэтому без миграции UPDATE в БД упадёт.
--   2) Добавляет колонку `is_demo` (если её ещё нет).
--      Для совместимости со схемой типа DataSource.isDemo — реальные
--      записи в БД остаются с FALSE, демо-источник живёт in-memory.
--   3) Создаёт триггер `data_sources_set_updated_at` для авто-обновления
--      updated_at на каждом UPDATE (страховка на случай если запись
--      обновляется напрямую SQL-ом, минуя приложение).
-- ============================================================================

ALTER TABLE public.data_sources
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.data_sources
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.set_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS data_sources_set_updated_at ON public.data_sources;
CREATE TRIGGER data_sources_set_updated_at
  BEFORE UPDATE ON public.data_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_column();
