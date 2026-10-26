-- AI GoMobile — схема пользовательских данных (источники, датасеты, визуализации,
-- история AI-анализов, настройки). Выполняется один раз в SQL Editor проекта
-- Supabase. Демо-данные в этих таблицах не сохраняются — они живут
-- in-memory на фронте.

-- ============================================================================
-- data_sources
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  database_name TEXT NOT NULL,
  username TEXT NOT NULL,
  password_encrypted TEXT NOT NULL DEFAULT '',
  ssl BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'unknown',
  status_message TEXT,
  tables JSONB,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Миграция для проектов, где таблица была создана до добавления полей.
-- См. также supabase/schema-fix-datasources.sql.
ALTER TABLE public.data_sources
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.data_sources
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS data_sources_user_id_idx
  ON public.data_sources (user_id);

ALTER TABLE public.data_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own data_sources" ON public.data_sources;
CREATE POLICY "Users can view own data_sources"
  ON public.data_sources FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own data_sources" ON public.data_sources;
CREATE POLICY "Users can insert own data_sources"
  ON public.data_sources FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own data_sources" ON public.data_sources;
CREATE POLICY "Users can update own data_sources"
  ON public.data_sources FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own data_sources" ON public.data_sources;
CREATE POLICY "Users can delete own data_sources"
  ON public.data_sources FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- datasets
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data_source_id UUID NOT NULL REFERENCES public.data_sources(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  table_name TEXT,
  sql_query TEXT,
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  calculated_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_count INTEGER,
  business_context TEXT,
  funnel_steps JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Миграция для ранее созданных таблиц (безопасно для свежей схемы тоже).
ALTER TABLE public.datasets ADD COLUMN IF NOT EXISTS business_context TEXT;
ALTER TABLE public.datasets ADD COLUMN IF NOT EXISTS funnel_steps JSONB;

CREATE INDEX IF NOT EXISTS datasets_user_id_idx ON public.datasets (user_id);
CREATE INDEX IF NOT EXISTS datasets_data_source_id_idx
  ON public.datasets (data_source_id);

ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own datasets" ON public.datasets;
CREATE POLICY "Users can view own datasets"
  ON public.datasets FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own datasets" ON public.datasets;
CREATE POLICY "Users can insert own datasets"
  ON public.datasets FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own datasets" ON public.datasets;
CREATE POLICY "Users can update own datasets"
  ON public.datasets FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own datasets" ON public.datasets;
CREATE POLICY "Users can delete own datasets"
  ON public.datasets FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- visualizations
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.visualizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Вычисляемые поля, живущие ТОЛЬКО внутри этой визуализации
  -- (применяются поверх dataset.calculated_fields). Сессия 27.
  visualization_calculated_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Миграция для проектов, где таблица была создана до добавления полей.
ALTER TABLE public.visualizations
  ADD COLUMN IF NOT EXISTS visualization_calculated_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS visualizations_user_id_idx
  ON public.visualizations (user_id);
CREATE INDEX IF NOT EXISTS visualizations_dataset_id_idx
  ON public.visualizations (dataset_id);

ALTER TABLE public.visualizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own visualizations" ON public.visualizations;
CREATE POLICY "Users can view own visualizations"
  ON public.visualizations FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own visualizations" ON public.visualizations;
CREATE POLICY "Users can insert own visualizations"
  ON public.visualizations FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own visualizations" ON public.visualizations;
CREATE POLICY "Users can update own visualizations"
  ON public.visualizations FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own visualizations" ON public.visualizations;
CREATE POLICY "Users can delete own visualizations"
  ON public.visualizations FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- ai_analyses
-- ============================================================================
-- data_id хранится TEXT — это позволяет ссылаться и на реальные сущности
-- (UUID датасета/визуализации) и на демо (строковые ID вида
-- "demo-dataset-campaigns").
CREATE TABLE IF NOT EXISTS public.ai_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data_type TEXT NOT NULL CHECK (data_type IN ('dataset', 'visualization')),
  data_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  cost NUMERIC NOT NULL DEFAULT 0,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Миграция для ранее созданных таблиц (безопасно для свежей схемы тоже).
ALTER TABLE public.ai_analyses ADD COLUMN IF NOT EXISTS model TEXT;

CREATE INDEX IF NOT EXISTS ai_analyses_user_id_idx
  ON public.ai_analyses (user_id);
CREATE INDEX IF NOT EXISTS ai_analyses_created_at_idx
  ON public.ai_analyses (user_id, created_at DESC);

ALTER TABLE public.ai_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own ai_analyses" ON public.ai_analyses;
CREATE POLICY "Users can view own ai_analyses"
  ON public.ai_analyses FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own ai_analyses" ON public.ai_analyses;
CREATE POLICY "Users can insert own ai_analyses"
  ON public.ai_analyses FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own ai_analyses" ON public.ai_analyses;
CREATE POLICY "Users can delete own ai_analyses"
  ON public.ai_analyses FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- ai_projects
-- ============================================================================
-- Проекты AI-анализа. Каждый проект привязан к датасету и хранит настройки
-- фильтров, модель, сохранённый промпт и настройки конструктора. Запуски
-- хранятся в отдельной таблице ai_project_runs (см. ниже).
CREATE TABLE IF NOT EXISTS public.ai_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  dataset_id TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'sonnet',
  filters_config JSONB NOT NULL DEFAULT '[]'::jsonb,
  filter_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  prompt TEXT,
  builder_config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_projects_user_id_idx
  ON public.ai_projects (user_id);
CREATE INDEX IF NOT EXISTS ai_projects_updated_at_idx
  ON public.ai_projects (user_id, updated_at DESC);

ALTER TABLE public.ai_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own ai_projects" ON public.ai_projects;
CREATE POLICY "Users can view own ai_projects"
  ON public.ai_projects FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own ai_projects" ON public.ai_projects;
CREATE POLICY "Users can insert own ai_projects"
  ON public.ai_projects FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own ai_projects" ON public.ai_projects;
CREATE POLICY "Users can update own ai_projects"
  ON public.ai_projects FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own ai_projects" ON public.ai_projects;
CREATE POLICY "Users can delete own ai_projects"
  ON public.ai_projects FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- ai_project_runs
-- ============================================================================
-- История запусков внутри проекта. Лимит «последние 30 на проект» поддерживается
-- приложением: при чтении берётся LIMIT 30, ничего страшного не случится, если
-- их в таблице больше.
CREATE TABLE IF NOT EXISTS public.ai_project_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.ai_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  cost NUMERIC NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT 'sonnet',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  filters_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_project_runs_project_id_idx
  ON public.ai_project_runs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_project_runs_user_id_idx
  ON public.ai_project_runs (user_id);

ALTER TABLE public.ai_project_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own ai_project_runs" ON public.ai_project_runs;
CREATE POLICY "Users can view own ai_project_runs"
  ON public.ai_project_runs FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own ai_project_runs" ON public.ai_project_runs;
CREATE POLICY "Users can insert own ai_project_runs"
  ON public.ai_project_runs FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own ai_project_runs" ON public.ai_project_runs;
CREATE POLICY "Users can delete own ai_project_runs"
  ON public.ai_project_runs FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- user_settings (one row per user)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light')),
  anthropic_api_key TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own user_settings" ON public.user_settings;
CREATE POLICY "Users can view own user_settings"
  ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own user_settings" ON public.user_settings;
CREATE POLICY "Users can insert own user_settings"
  ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own user_settings" ON public.user_settings;
CREATE POLICY "Users can update own user_settings"
  ON public.user_settings FOR UPDATE USING (auth.uid() = user_id);
