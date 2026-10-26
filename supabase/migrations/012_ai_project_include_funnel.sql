-- 012: опциональная передача воронки в AI-контекст.
-- Воронка датасета уходит в промпт Claude только если пользователь включил это
-- в проекте (по умолчанию выключено — воронка лишь фоновый контекст, не команда).
-- Идемпотентно. RLS на ai_projects уже есть.

ALTER TABLE public.ai_projects
  ADD COLUMN IF NOT EXISTS include_funnel boolean NOT NULL DEFAULT false;
