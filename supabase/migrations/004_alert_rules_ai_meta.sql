-- Сессия 36 (2026-05-11) — добавляем колонку alert_rules.ai_meta.
--
-- Контекст: код AI-генератора правил (PR #8) пишет в `alert_rules` поле
-- `ai_meta` (метаданные генерации: запрос байера, модель, обоснование, …),
-- но на проде колонки нет (миграцию 001_telegram_alerts.sql применяли ДО
-- того, как в неё добавили `ai_meta JSONB`). Из-за этого Supabase/PostgREST
-- падает: «Could not find the 'ai_meta' column of 'alert_rules' in the
-- schema cache».
--
-- Шаг идемпотентный — безопасно применять на любой версии схемы.
--
-- Структура `ai_meta` (соответствует TS-типу `AlertAiMeta` в lib/types.ts):
--   {
--     "userQuery":   "креативы, которые выгорают за 3 дня",
--     "model":       "haiku" | "sonnet" | "opus",
--     "generatedAt": "2026-05-11T12:00:00.000Z",
--     "confidence":  "high" | "med" | "low",
--     "reasoning":   "..."
--   }

ALTER TABLE public.alert_rules
  ADD COLUMN IF NOT EXISTS ai_meta JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.alert_rules.ai_meta IS
  'Метаданные от AI-генератора: prompt-контекст, версия модели, обоснование правила, и т.п.';

-- На случай, если PostgREST держит устаревший schema cache — попросим перезагрузить.
NOTIFY pgrst, 'reload schema';
