-- 011: описание источника данных (свободный текст «для чего этот источник»).
-- Идемпотентно. RLS на data_sources уже есть (политики покрывают все колонки).
-- Колонка nullable — старые источники остаются без описания.

ALTER TABLE public.data_sources
  ADD COLUMN IF NOT EXISTS description text;
