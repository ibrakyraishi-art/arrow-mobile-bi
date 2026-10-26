-- 005: конфигурация «конструктора анализа» (pivot) для alert-правил.
-- Хранит метрики, value-фильтры, сортировку, топ-N и диапазон дат одним jsonb.
-- Аддитивно и идемпотентно: старые правила получают '{}' и работают по-старому.

ALTER TABLE public.alert_rules
  ADD COLUMN IF NOT EXISTS analysis_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.alert_rules.analysis_config IS
  'Конфиг конструктора анализа: { metrics, valueFilters, sort, topN, dateRange }.';

-- Обновляем schema cache PostgREST, чтобы новая колонка сразу была видна через REST.
NOTIFY pgrst, 'reload schema';
