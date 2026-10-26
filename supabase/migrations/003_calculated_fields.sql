-- Сессия 27 (2026-05-09) — Вычисляемые поля в датасетах и визуализациях.
--
-- Контекст:
-- 1) Колонка `datasets.calculated_fields` уже была добавлена в исходной схеме
--    (`supabase/schema-data.sql`). Здесь дублируем `ADD COLUMN IF NOT EXISTS`
--    как идемпотентный шаг — на случай если у кого-то проект ещё на старой
--    схеме.
-- 2) `visualizations.visualization_calculated_fields` — новая колонка,
--    хранит вычисляемые поля, живущие ТОЛЬКО внутри одной визуализации
--    (применяются поверх `dataset.calculated_fields`).
--
-- Схема одного элемента в обеих JSONB-колонках:
--   {
--     "id":          "uuid или nanoid",
--     "name":        "ARPU",
--     "formula":     "[revenue] / [installs]",
--     "datasetType": "float" | "integer",
--     "format":      "number" | "integer" | "currency_usd" | "currency_rub" | "percent",
--     "description": "Доход на одну установку",
--     "aiDescription": "..."
--   }
--
-- Все поля кроме `id`, `name`, `formula`, `datasetType` опциональны
-- (используются только в UI/форматировании).

ALTER TABLE public.datasets
  ADD COLUMN IF NOT EXISTS calculated_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.visualizations
  ADD COLUMN IF NOT EXISTS visualization_calculated_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Никаких индексов / RLS-изменений: RLS у обеих таблиц уже включён,
-- права наследуются для всех колонок.
