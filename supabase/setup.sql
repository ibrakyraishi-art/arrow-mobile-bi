-- ============================================================================
-- AI GoMobile — единый скрипт установки базы данных.
--
-- Выполнить ОДИН РАЗ в SQL Editor нового проекта Supabase
-- (Dashboard → SQL Editor → New query → вставить весь файл → Run).
--
-- ПЕРЕД ЗАПУСКОМ: найдите в файле 'admin@your-company.com' (функция
-- public.is_admin(), раздел 017) и замените на email администратора вашей
-- компании — тот же, что в переменной окружения ADMIN_EMAIL.
--
-- Файл собран из supabase/schema*.sql и supabase/migrations/*.sql в порядке
-- применения (порядок — в разделителях ниже). Если меняете исходные файлы —
-- пересоберите setup.sql, а не правьте его вручную.
--
-- Рассчитан на чистый проект Supabase (схемы auth и storage, роли anon /
-- authenticated / service_role уже есть). Повторный запуск не должен падать.
-- ============================================================================

create extension if not exists pgcrypto;

-- Общая функция для триггеров updated_at. Используется в 008 (ALTER FUNCTION),
-- 009, 010, 017. В исходных файлах репозитория она не создаётся — определение
-- взято из рабочей базы.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


-- ############################################################################
-- ### supabase/schema.sql
-- ############################################################################

-- AI GoMobile — схема Supabase Auth (профили + RLS).
-- Выполняется один раз в SQL Editor проекта Supabase.

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  role TEXT CHECK (role IN ('admin', 'analyst', 'buyer', 'manager')) DEFAULT 'buyer',
  company TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Автосоздание профиля при регистрации
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'buyer')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );


-- ############################################################################
-- ### supabase/schema-data.sql
-- ############################################################################

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


-- ############################################################################
-- ### supabase/schema-fix-datasources.sql
-- ############################################################################

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


-- ############################################################################
-- ### supabase/schema-dashboards.sql
-- ############################################################################

-- AI GoMobile — схема дашбордов (dashboards + sheets + widgets).
-- Выполняется один раз в SQL Editor проекта Supabase.
-- Демо-дашборд в этих таблицах не сохраняется — он живёт in-memory на фронте.

-- ============================================================================
-- dashboards
-- ============================================================================
-- dataset_id хранится TEXT — это позволяет ссылаться и на реальные датасеты
-- (UUID) и на демо ("demo-dataset-campaigns").
CREATE TABLE IF NOT EXISTS public.dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dataset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  filters_config JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dashboards_user_id_idx
  ON public.dashboards (user_id);

ALTER TABLE public.dashboards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own dashboards" ON public.dashboards;
CREATE POLICY "Users can view own dashboards"
  ON public.dashboards FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own dashboards" ON public.dashboards;
CREATE POLICY "Users can insert own dashboards"
  ON public.dashboards FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own dashboards" ON public.dashboards;
CREATE POLICY "Users can update own dashboards"
  ON public.dashboards FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own dashboards" ON public.dashboards;
CREATE POLICY "Users can delete own dashboards"
  ON public.dashboards FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- dashboard_sheets
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.dashboard_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id UUID NOT NULL REFERENCES public.dashboards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dashboard_sheets_dashboard_id_idx
  ON public.dashboard_sheets (dashboard_id);

ALTER TABLE public.dashboard_sheets ENABLE ROW LEVEL SECURITY;

-- RLS наследуется через dashboards.user_id.
DROP POLICY IF EXISTS "Users can view own dashboard_sheets" ON public.dashboard_sheets;
CREATE POLICY "Users can view own dashboard_sheets"
  ON public.dashboard_sheets FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.dashboards d
      WHERE d.id = dashboard_id AND d.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Users can insert own dashboard_sheets" ON public.dashboard_sheets;
CREATE POLICY "Users can insert own dashboard_sheets"
  ON public.dashboard_sheets FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.dashboards d
      WHERE d.id = dashboard_id AND d.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Users can update own dashboard_sheets" ON public.dashboard_sheets;
CREATE POLICY "Users can update own dashboard_sheets"
  ON public.dashboard_sheets FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.dashboards d
      WHERE d.id = dashboard_id AND d.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Users can delete own dashboard_sheets" ON public.dashboard_sheets;
CREATE POLICY "Users can delete own dashboard_sheets"
  ON public.dashboard_sheets FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.dashboards d
      WHERE d.id = dashboard_id AND d.user_id = auth.uid()
    )
  );

-- ============================================================================
-- dashboard_widgets
-- ============================================================================
-- visualization_id хранится TEXT — ссылается и на реальные визуализации, и на
-- демо ("demo-viz-1"). Nullable, т.к. метрики и текстовые блоки не требуют
-- существующей визуализации.
CREATE TABLE IF NOT EXISTS public.dashboard_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES public.dashboard_sheets(id) ON DELETE CASCADE,
  visualization_id TEXT,
  widget_type TEXT NOT NULL CHECK (widget_type IN ('chart','pivot','metric','text')),
  title TEXT NOT NULL DEFAULT '',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  width TEXT NOT NULL DEFAULT 'full' CHECK (width IN ('full','half','third')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dashboard_widgets_sheet_id_idx
  ON public.dashboard_widgets (sheet_id);

ALTER TABLE public.dashboard_widgets ENABLE ROW LEVEL SECURITY;

-- RLS наследуется через dashboard_sheets.dashboard_id → dashboards.user_id.
DROP POLICY IF EXISTS "Users can view own dashboard_widgets" ON public.dashboard_widgets;
CREATE POLICY "Users can view own dashboard_widgets"
  ON public.dashboard_widgets FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.dashboard_sheets s
      JOIN public.dashboards d ON d.id = s.dashboard_id
      WHERE s.id = sheet_id AND d.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Users can insert own dashboard_widgets" ON public.dashboard_widgets;
CREATE POLICY "Users can insert own dashboard_widgets"
  ON public.dashboard_widgets FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.dashboard_sheets s
      JOIN public.dashboards d ON d.id = s.dashboard_id
      WHERE s.id = sheet_id AND d.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Users can update own dashboard_widgets" ON public.dashboard_widgets;
CREATE POLICY "Users can update own dashboard_widgets"
  ON public.dashboard_widgets FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.dashboard_sheets s
      JOIN public.dashboards d ON d.id = s.dashboard_id
      WHERE s.id = sheet_id AND d.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Users can delete own dashboard_widgets" ON public.dashboard_widgets;
CREATE POLICY "Users can delete own dashboard_widgets"
  ON public.dashboard_widgets FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM public.dashboard_sheets s
      JOIN public.dashboards d ON d.id = s.dashboard_id
      WHERE s.id = sheet_id AND d.user_id = auth.uid()
    )
  );


-- ############################################################################
-- ### supabase/schema-audit.sql
-- ############################################################################

-- AI GoMobile — журнал действий пользователя (audit log).
-- Таблица создаётся отдельно от schema-data.sql. Все запросы клиента
-- идут под RLS — пользователь видит только свои записи; вставка тоже
-- проверяется RLS, так что подделать чужой user_id не выйдет.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_user_id_created_at_idx
  ON public.audit_log (user_id, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own audit_log" ON public.audit_log;
CREATE POLICY "Users can view own audit_log"
  ON public.audit_log FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own audit_log" ON public.audit_log;
CREATE POLICY "Users can insert own audit_log"
  ON public.audit_log FOR INSERT WITH CHECK (auth.uid() = user_id);


-- ############################################################################
-- ### supabase/migrations/001_telegram_alerts.sql
-- ############################################################################

-- AI GoMobile — Telegram-алерты: подключения, шаблоны, правила, история запусков.
-- Для документации и единого источника правды. Таблицы могут уже существовать в проекте.
-- Выполнение здесь необязательно, если объекты созданы вручную ранее.

-- ---------------------------------------------------------------------------
-- Таблицы
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.telegram_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bot_username TEXT,
  bot_token_encrypted TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  chat_title TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  last_test_at TIMESTAMPTZ,
  last_test_status TEXT,
  last_test_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_connections_user_id
  ON public.telegram_connections (user_id);

CREATE TABLE IF NOT EXISTS public.notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  parse_mode TEXT NOT NULL DEFAULT 'markdownv2',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_templates_user_id
  ON public.notification_templates (user_id);

CREATE TABLE IF NOT EXISTS public.alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT NOT NULL DEFAULT 'manual',
  ai_meta JSONB,
  dataset_id UUID NOT NULL,
  group_by TEXT NOT NULL,
  period_days INTEGER NOT NULL DEFAULT 1,
  min_spend_filter NUMERIC,
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  telegram_connection_id UUID NOT NULL,
  template_id UUID NOT NULL,
  tag_users TEXT,
  use_ai_recommendation BOOLEAN NOT NULL DEFAULT false,
  ai_model TEXT,
  schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  last_run_message TEXT,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_user_id ON public.alert_rules (user_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_next_run_active
  ON public.alert_rules (next_run_at)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.alert_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  rule_id UUID NOT NULL,
  rule_name TEXT NOT NULL,
  status TEXT NOT NULL,
  matched_count INTEGER NOT NULL DEFAULT 0,
  matched_objects JSONB NOT NULL DEFAULT '[]'::jsonb,
  message TEXT NOT NULL DEFAULT '',
  ai_recommendation TEXT,
  used_ai BOOLEAN NOT NULL DEFAULT false,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_runs_user_id ON public.alert_runs (user_id);
CREATE INDEX IF NOT EXISTS idx_alert_runs_rule_id ON public.alert_runs (rule_id);
CREATE INDEX IF NOT EXISTS idx_alert_runs_created_at ON public.alert_runs (created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS (жёстко: строки только владельца user_id)
-- ---------------------------------------------------------------------------

ALTER TABLE public.telegram_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "telegram_connections_select_own" ON public.telegram_connections;
DROP POLICY IF EXISTS "telegram_connections_insert_own" ON public.telegram_connections;
DROP POLICY IF EXISTS "telegram_connections_update_own" ON public.telegram_connections;
DROP POLICY IF EXISTS "telegram_connections_delete_own" ON public.telegram_connections;

CREATE POLICY "telegram_connections_select_own"
  ON public.telegram_connections FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "telegram_connections_insert_own"
  ON public.telegram_connections FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "telegram_connections_update_own"
  ON public.telegram_connections FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "telegram_connections_delete_own"
  ON public.telegram_connections FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "notification_templates_select_own" ON public.notification_templates;
DROP POLICY IF EXISTS "notification_templates_insert_own" ON public.notification_templates;
DROP POLICY IF EXISTS "notification_templates_update_own" ON public.notification_templates;
DROP POLICY IF EXISTS "notification_templates_delete_own" ON public.notification_templates;

CREATE POLICY "notification_templates_select_own"
  ON public.notification_templates FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "notification_templates_insert_own"
  ON public.notification_templates FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "notification_templates_update_own"
  ON public.notification_templates FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "notification_templates_delete_own"
  ON public.notification_templates FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "alert_rules_select_own" ON public.alert_rules;
DROP POLICY IF EXISTS "alert_rules_insert_own" ON public.alert_rules;
DROP POLICY IF EXISTS "alert_rules_update_own" ON public.alert_rules;
DROP POLICY IF EXISTS "alert_rules_delete_own" ON public.alert_rules;

CREATE POLICY "alert_rules_select_own"
  ON public.alert_rules FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "alert_rules_insert_own"
  ON public.alert_rules FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "alert_rules_update_own"
  ON public.alert_rules FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "alert_rules_delete_own"
  ON public.alert_rules FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "alert_runs_select_own" ON public.alert_runs;
DROP POLICY IF EXISTS "alert_runs_insert_own" ON public.alert_runs;
DROP POLICY IF EXISTS "alert_runs_update_own" ON public.alert_runs;
DROP POLICY IF EXISTS "alert_runs_delete_own" ON public.alert_runs;

CREATE POLICY "alert_runs_select_own"
  ON public.alert_runs FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "alert_runs_insert_own"
  ON public.alert_runs FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "alert_runs_update_own"
  ON public.alert_runs FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "alert_runs_delete_own"
  ON public.alert_runs FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);


-- ############################################################################
-- ### supabase/migrations/002_telegram_connections_grants.sql
-- ############################################################################

-- Явные права на telegram_connections (если таблицу создавали вручную в SQL Editor,
-- иногда не хватает GRANT для роли authenticated — INSERT/SELECT падают с permission denied).
-- Идемпотентно: повторный GRANT безопасен.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.telegram_connections TO authenticated;
GRANT ALL ON TABLE public.telegram_connections TO service_role;


-- ############################################################################
-- ### supabase/migrations/003_calculated_fields.sql
-- ############################################################################

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


-- ############################################################################
-- ### supabase/migrations/004_alert_rules_ai_meta.sql
-- ############################################################################

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


-- ############################################################################
-- ### supabase/migrations/005_alert_rules_analysis.sql
-- ############################################################################

-- 005: конфигурация «конструктора анализа» (pivot) для alert-правил.
-- Хранит метрики, value-фильтры, сортировку, топ-N и диапазон дат одним jsonb.
-- Аддитивно и идемпотентно: старые правила получают '{}' и работают по-старому.

ALTER TABLE public.alert_rules
  ADD COLUMN IF NOT EXISTS analysis_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.alert_rules.analysis_config IS
  'Конфиг конструктора анализа: { metrics, valueFilters, sort, topN, dateRange }.';

-- Обновляем schema cache PostgREST, чтобы новая колонка сразу была видна через REST.
NOTIFY pgrst, 'reload schema';


-- ############################################################################
-- ### supabase/migrations/006_cleanup_prefixed_templates.sql
-- ############################################################################

-- 006: чистка старых AI/Insight-шаблонов уведомлений.
-- Они построены на «мёртвых» переменных ({code}, {channel}, {GEO}, {matches_count})
-- от удалённого AI-генератора. Подход перешёл на {table} (Конструктор анализа).
-- Сид-механизма шаблонов нет — удаляем существующие данные по префиксу имени.
-- Идемпотентно: повторный прогон просто ничего не найдёт.
-- FK alert_rules.template_id = ON DELETE SET NULL, поэтому правила не ломаются.

DELETE FROM public.notification_templates
WHERE name LIKE '[AI]%' OR name LIKE '[Insight]%';


-- ############################################################################
-- ### supabase/migrations/007_alert_rules_ai_model_nullable.sql
-- ############################################################################

-- 007: ai_model больше не заполняется (AI-генерация удалена в PR #51).
-- Колонка осталась NOT NULL DEFAULT 'haiku' с момента создания — из-за этого
-- вставка правила без AI-полей (ai_model = null) падала с
-- «null value in column "ai_model" violates not-null constraint».
-- Снимаем NOT NULL и default. Идемпотентно.

ALTER TABLE public.alert_rules ALTER COLUMN ai_model DROP NOT NULL;
ALTER TABLE public.alert_rules ALTER COLUMN ai_model DROP DEFAULT;

-- Обновляем schema cache PostgREST.
NOTIFY pgrst, 'reload schema';


-- ############################################################################
-- ### supabase/migrations/008_security_hardening.sql
-- ############################################################################

-- 008: Security hardening — закрытие WARN из Supabase Security Advisor.
-- Применено к prod через MCP; здесь для воспроизводимости. Идемпотентно.

-- 1) audit_log INSERT был WITH CHECK (true) → ограничиваем своим user_id.
DROP POLICY IF EXISTS "System can insert audit log" ON public.audit_log;
DROP POLICY IF EXISTS "Users insert own audit log" ON public.audit_log;
CREATE POLICY "Users insert own audit log"
  ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- 2) Hardening функций: фиксируем search_path, отзываем RPC EXECUTE у триггеров.
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'buyer')
  );
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.set_updated_at() SET search_path = '';

REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
-- rls_auto_enable() создаётся Supabase только если при создании проекта включена
-- опция «Automatically enable RLS»; в репозитории её нет. Без проверки REVOKE на
-- чистой базе падает с «function public.rls_auto_enable() does not exist».
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM anon, authenticated, public;
  END IF;
END
$$;

-- 3) Индексы на user_id (RLS perf + advisor).
CREATE INDEX IF NOT EXISTS idx_ai_analyses_user_id ON public.ai_analyses (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_project_runs_user_id ON public.ai_project_runs (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_projects_user_id ON public.ai_projects (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON public.audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_user_id ON public.dashboards (user_id);
CREATE INDEX IF NOT EXISTS idx_data_sources_user_id ON public.data_sources (user_id);
CREATE INDEX IF NOT EXISTS idx_datasets_user_id ON public.datasets (user_id);
CREATE INDEX IF NOT EXISTS idx_visualizations_user_id ON public.visualizations (user_id);

NOTIFY pgrst, 'reload schema';


-- ############################################################################
-- ### supabase/migrations/009_ai_confidentiality.sql
-- ############################################################################

-- 009: Режим конфиденциальности AI-анализа (обратимая токенизация / NDA).
-- Применено к prod через MCP; здесь — для воспроизводимости. Идемпотентно.

-- Список конфиденциальных столбцов проекта (не секрет — нужен UI для замков).
-- По умолчанию [] → режим выключен, старые проекты работают как раньше.
ALTER TABLE public.ai_projects
  ADD COLUMN IF NOT EXISTS confidential_columns jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Словарь замен (реальное значение ↔ код): зашифрован (AES), 1 строка на проект,
-- только на сервере, под RLS. В Claude не уходит никогда.
CREATE TABLE IF NOT EXISTS public.ai_anonymization_maps (
  project_id    uuid PRIMARY KEY REFERENCES public.ai_projects(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  map_encrypted text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_anonymization_maps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own anonymization maps" ON public.ai_anonymization_maps;
CREATE POLICY "Users manage own anonymization maps"
  ON public.ai_anonymization_maps
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ai_anonymization_maps_user_id
  ON public.ai_anonymization_maps (user_id);

DROP TRIGGER IF EXISTS set_ai_anon_maps_updated_at ON public.ai_anonymization_maps;
CREATE TRIGGER set_ai_anon_maps_updated_at
  BEFORE UPDATE ON public.ai_anonymization_maps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

NOTIFY pgrst, 'reload schema';


-- ############################################################################
-- ### supabase/migrations/010_file_sources.sql
-- ############################################################################

-- 010: источники данных из файлов (CSV/Excel) и Google Sheets.
-- Применено к prod через MCP; здесь для воспроизводимости. Идемпотентно.
-- Тип источника + таблица с распарсенными строками (движок считает in-JS, как демо).

ALTER TABLE public.data_sources
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'clickhouse';

CREATE TABLE IF NOT EXISTS public.file_sources (
  data_source_id uuid PRIMARY KEY REFERENCES public.data_sources(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL,
  format         text NOT NULL DEFAULT 'csv',           -- 'csv' | 'excel' | 'gsheet'
  columns        jsonb NOT NULL DEFAULT '[]'::jsonb,     -- ColumnInfo[]
  rows           jsonb NOT NULL DEFAULT '[]'::jsonb,     -- QueryResultRow[]
  row_count      integer NOT NULL DEFAULT 0,
  source_meta    jsonb,                                  -- {fileName, sheetUrl}
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.file_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own file sources" ON public.file_sources;
CREATE POLICY "Users manage own file sources"
  ON public.file_sources FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_file_sources_user_id ON public.file_sources (user_id);

DROP TRIGGER IF EXISTS set_file_sources_updated_at ON public.file_sources;
CREATE TRIGGER set_file_sources_updated_at
  BEFORE UPDATE ON public.file_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

NOTIFY pgrst, 'reload schema';


-- ############################################################################
-- ### supabase/migrations/011_data_source_description.sql
-- ############################################################################

-- 011: описание источника данных (свободный текст «для чего этот источник»).
-- Идемпотентно. RLS на data_sources уже есть (политики покрывают все колонки).
-- Колонка nullable — старые источники остаются без описания.

ALTER TABLE public.data_sources
  ADD COLUMN IF NOT EXISTS description text;


-- ############################################################################
-- ### supabase/migrations/012_ai_project_include_funnel.sql
-- ############################################################################

-- 012: опциональная передача воронки в AI-контекст.
-- Воронка датасета уходит в промпт Claude только если пользователь включил это
-- в проекте (по умолчанию выключено — воронка лишь фоновый контекст, не команда).
-- Идемпотентно. RLS на ai_projects уже есть.

ALTER TABLE public.ai_projects
  ADD COLUMN IF NOT EXISTS include_funnel boolean NOT NULL DEFAULT false;


-- ############################################################################
-- ### supabase/migrations/013_llm_provider_keys.sql
-- ############################################################################

-- Мультипровайдерность LLM: ключи OpenAI и Google (Gemini) для AI-анализа.
-- BYOK — каждый пользователь хранит свой ключ, зашифрованным (как anthropic_api_key).
-- Идемпотентно. RLS на user_settings уже есть (auth.uid() = user_id), новые
-- столбцы наследуют политику таблицы.

alter table public.user_settings
  add column if not exists openai_api_key text,
  add column if not exists google_api_key text;


-- ############################################################################
-- ### supabase/migrations/014_free_tier_provider_keys.sql
-- ############################################################################

-- Ключи бесплатно-тирных LLM-провайдеров: Groq, Cerebras, Mistral. BYOK,
-- хранятся зашифрованными (как остальные *_api_key). Идемпотентно. RLS на
-- user_settings уже есть (auth.uid() = user_id) — новые столбцы её наследуют.

alter table public.user_settings
  add column if not exists groq_api_key text,
  add column if not exists cerebras_api_key text,
  add column if not exists mistral_api_key text;


-- ############################################################################
-- ### supabase/migrations/015_cascade_delete_no_orphans.sql
-- ############################################################################

-- 015: удаление источника/датасета «подчистую» — без осиротевших хвостов.
-- Применено к prod через MCP; здесь для воспроизводимости. Идемпотентно.
--
-- Было: при удалении датасета алерт-правило и виджет дашборда лишь обнуляли
-- ссылку (SET NULL) и оставались висеть в БД. Стало: каскадно удаляются.
-- Полная цепочка от источника:
--   data_sources -> datasets (CASCADE, было) -> visualizations (CASCADE, было)
--                                            -> alert_rules (теперь CASCADE)
--                                                 -> alert_runs (CASCADE, было)
--   visualizations -> dashboard_widgets (теперь CASCADE)
--   data_sources -> file_sources (CASCADE, было)
-- RLS не затрагивается.

ALTER TABLE public.alert_rules DROP CONSTRAINT IF EXISTS alert_rules_dataset_id_fkey;
ALTER TABLE public.alert_rules
  ADD CONSTRAINT alert_rules_dataset_id_fkey
  FOREIGN KEY (dataset_id) REFERENCES public.datasets(id) ON DELETE CASCADE;

ALTER TABLE public.dashboard_widgets DROP CONSTRAINT IF EXISTS dashboard_widgets_visualization_id_fkey;
-- schema-dashboards.sql создаёт visualization_id как TEXT (под демо-id «demo-viz-…»),
-- а visualizations.id — UUID: FK между ними невозможен («foreign key constraint
-- cannot be implemented»). Раз FK применён на проде, там колонка уже uuid —
-- приводим тип. На uuid-колонке это no-op; если в колонке есть не-UUID значения
-- (демо-id), команда упадёт — такие строки нужно удалить заранее.
ALTER TABLE public.dashboard_widgets
  ALTER COLUMN visualization_id TYPE uuid USING visualization_id::uuid;
ALTER TABLE public.dashboard_widgets
  ADD CONSTRAINT dashboard_widgets_visualization_id_fkey
  FOREIGN KEY (visualization_id) REFERENCES public.visualizations(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';


-- ############################################################################
-- ### supabase/migrations/016_cleanup_ai_projects_on_dataset_delete.sql
-- ############################################################################

-- 016: чистка AI-проектов при удалении датасета (часть «удаления подчистую»).
-- Применено к prod через MCP; здесь для воспроизводимости. Идемпотентно.
--
-- Проблема: ai_projects.dataset_id хранится как TEXT (поддерживает демо-id вроде
-- 'demo-dataset-campaigns'), поэтому внешний ключ/каскад на datasets невозможен.
-- При удалении датасета (в т.ч. каскадном от источника) AI-проекты оставались
-- осиротевшими (dataset_id указывал на несуществующий датасет).
--
-- Решение: триггер AFTER DELETE на datasets удаляет ai_projects этого датасета.
-- Дочерние ai_project_runs / ai_anonymization_maps уйдут каскадом (их FK на
-- ai_projects уже ON DELETE CASCADE). Демо-проекты не затрагиваются: для демо
-- реальная строка datasets не удаляется, значит событие не срабатывает.

create or replace function public.delete_ai_projects_for_dataset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ai_projects where dataset_id = old.id::text;
  return old;
end;
$$;

drop trigger if exists trg_datasets_cleanup_ai_projects on public.datasets;
create trigger trg_datasets_cleanup_ai_projects
  after delete on public.datasets
  for each row execute function public.delete_ai_projects_for_dataset();


-- ############################################################################
-- ### supabase/migrations/017_admin_feedback.sql
-- ############################################################################

-- 017_admin_feedback.sql — обратная связь пользователей + админ-доступ.
-- Идемпотентно. Безопасность:
--   • RLS: пользователь видит/создаёт ТОЛЬКО свои заявки; админ — все.
--   • Админ для RLS определяется по email из проверенного JWT (is_admin()).
--     На уровне роутов админ дополнительно проверяется по ADMIN_EMAIL (env) —
--     defense-in-depth. Email админа не секрет; реальный гейт — серверный.
--   • Скриншоты — приватный Storage-бакет, доступ только через серверные роуты
--     (service-role + короткоживущий signed URL); публичных политик у бакета нет.

-- Кто админ (для RLS-политик). Читает только собственный JWT — не SECURITY DEFINER.
-- 'admin@your-company.com' — замените на email администратора вашей компании (тот же, что в ADMIN_EMAIL)
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = lower('admin@your-company.com')
$$;
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Таблица обращений.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,                         -- денормализованный email автора (для админки)
  message text not null,
  page_url text,                      -- где возникла проблема
  screenshot_path text,               -- путь в бакете feedback-screenshots (nullable)
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'resolved')),
  admin_reply text,                   -- ответ администратора
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feedback_user_id_idx on public.feedback (user_id);
create index if not exists feedback_status_idx on public.feedback (status);
create index if not exists feedback_created_at_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

-- SELECT: автор своей заявки ИЛИ админ — всех.
drop policy if exists feedback_select on public.feedback;
create policy feedback_select on public.feedback for select
  using (auth.uid() = user_id or public.is_admin());

-- INSERT: только от своего имени (user_id = текущая сессия).
drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback for insert
  with check (auth.uid() = user_id);

-- UPDATE: только админ (смена статуса / ответ). Пользователь свою заявку не правит.
drop policy if exists feedback_update on public.feedback;
create policy feedback_update on public.feedback for update
  using (public.is_admin()) with check (public.is_admin());

-- DELETE: только админ.
drop policy if exists feedback_delete on public.feedback;
create policy feedback_delete on public.feedback for delete
  using (public.is_admin());

-- updated_at автоматически.
drop trigger if exists feedback_set_updated_at on public.feedback;
create trigger feedback_set_updated_at before update on public.feedback
  for each row execute function public.set_updated_at();

-- Приватный бакет для скриншотов области. Без публичных политик — доступ только
-- через серверные роуты (service-role: загрузка с валидацией + signed URL на чтение
-- автору/админу). Публично НЕ читается.
insert into storage.buckets (id, name, public)
values ('feedback-screenshots', 'feedback-screenshots', false)
on conflict (id) do nothing;


-- ############################################################################
-- ### supabase/migrations/018_admin_profiles_select.sql
-- ############################################################################

-- 018_admin_profiles_select.sql — админ видит все профили (для списка
-- пользователей в админке) ЧЕРЕЗ RLS, без service-role.
-- Дополнительная SELECT-политика поверх «свой профиль»; политики объединяются
-- по OR, поэтому обычный пользователь по-прежнему видит только себя.
-- Старая политика из schema.sql «Admins can view all profiles» читает
-- public.profiles внутри политики на public.profiles → Postgres отвечает
-- «infinite recursion detected in policy for relation "profiles"» на ЛЮБОЙ
-- SELECT профилей под ролью authenticated (в т.ч. «свой профиль»). Её роль
-- (админ видит всех) берёт на себя profiles_admin_select ниже — удаляем.
drop policy if exists "Admins can view all profiles" on public.profiles;
drop policy if exists profiles_admin_select on public.profiles;
create policy profiles_admin_select on public.profiles for select
  using (public.is_admin());


-- ############################################################################
-- ### supabase/migrations/019_file_source_live_mode.sql
-- ############################################################################

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


-- ############################################################################
-- ### supabase/migrations/020_email_is_registered.sql
-- ############################################################################

-- 020: проверка «email уже зарегистрирован» для формы регистрации.
-- Применено к prod через MCP; здесь для воспроизводимости. Идемпотентно
-- (create or replace).
--
-- Зачем: при повторной регистрации НЕподтверждённого email Supabase просто
-- ПЕРЕ-отправляет письмо и возвращает непустой `identities` → клиентская
-- проверка `identities.length === 0` (срабатывает только для ПОДТВЕРЖДённых)
-- не ловила это, и пользователь видел «письмо отправлено» вместо
-- «этот email уже зарегистрирован».
--
-- Решение: SECURITY DEFINER функция, возвращающая ТОЛЬКО boolean (без утечки
-- каких-либо данных), читает `auth.users` (источник истины — там и
-- неподтверждённые). Клиент дёргает её перед signUp.
--
-- Компромисс безопасности: это включает email enumeration (можно проверить,
-- занят ли email). Осознанно — это нужная UX при регистрации, и сам signUp
-- уже частично это раскрывает.

create or replace function public.email_is_registered(p_email text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where lower(u.email) = lower(trim(p_email))
  );
$$;

revoke all on function public.email_is_registered(text) from public;
grant execute on function public.email_is_registered(text) to anon, authenticated;


-- ############################################################################
-- ### supabase/migrations/021_plans.sql
-- ############################################################################

-- 021_plans.sql — план-проекты: план на месяц по полям датасета (план/факт).
-- Идемпотентно, только добавляет. Существующие таблицы не меняются.
-- Доступ: общая команда — любой вошедший (authenticated) видит и правит все
-- план-проекты; anon не может ничего (RLS без политик для anon + revoke).
-- dataset_id — text (как у dashboards), чтобы влезал id демо-датасета.

create table if not exists public.plan_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dataset_id text not null,
  date_column text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plan_fields (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.plan_projects(id) on delete cascade,
  label text not null,
  source_column text not null,          -- колонка или имя вычисляемого поля датасета
  kind text not null default 'volume'
    check (kind in ('volume', 'rate')),
  direction text not null default 'higher'
    check (direction in ('higher', 'lower', 'target')),
  format text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plan_values (
  field_id uuid not null references public.plan_fields(id) on delete cascade,
  month date not null,                  -- 1-е число месяца
  value numeric not null,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (field_id, month),
  constraint plan_values_month_first_day check (extract(day from month) = 1)
);

create index if not exists plan_projects_dataset_id_idx on public.plan_projects (dataset_id);
create index if not exists plan_fields_project_id_idx on public.plan_fields (project_id);
create index if not exists plan_values_field_id_idx on public.plan_values (field_id);

-- updated_at автоматически (своя функция, чтобы не зависеть от общих).
create or replace function public.plan_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists plan_projects_set_updated_at on public.plan_projects;
create trigger plan_projects_set_updated_at before update on public.plan_projects
  for each row execute function public.plan_touch_updated_at();

drop trigger if exists plan_fields_set_updated_at on public.plan_fields;
create trigger plan_fields_set_updated_at before update on public.plan_fields
  for each row execute function public.plan_touch_updated_at();

-- У значений плана ещё и автор последней правки.
create or replace function public.plan_values_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists plan_values_set_updated_at on public.plan_values;
create trigger plan_values_set_updated_at before update on public.plan_values
  for each row execute function public.plan_values_touch();

-- RLS: authenticated — всё по всем строкам; anon — ничего.
alter table public.plan_projects enable row level security;
alter table public.plan_fields enable row level security;
alter table public.plan_values enable row level security;

revoke all on public.plan_projects from anon;
revoke all on public.plan_fields from anon;
revoke all on public.plan_values from anon;
grant select, insert, update, delete on public.plan_projects to authenticated;
grant select, insert, update, delete on public.plan_fields to authenticated;
grant select, insert, update, delete on public.plan_values to authenticated;

drop policy if exists plan_projects_select on public.plan_projects;
create policy plan_projects_select on public.plan_projects for select to authenticated using (true);
drop policy if exists plan_projects_insert on public.plan_projects;
create policy plan_projects_insert on public.plan_projects for insert to authenticated with check (true);
drop policy if exists plan_projects_update on public.plan_projects;
create policy plan_projects_update on public.plan_projects for update to authenticated using (true) with check (true);
drop policy if exists plan_projects_delete on public.plan_projects;
create policy plan_projects_delete on public.plan_projects for delete to authenticated using (true);

drop policy if exists plan_fields_select on public.plan_fields;
create policy plan_fields_select on public.plan_fields for select to authenticated using (true);
drop policy if exists plan_fields_insert on public.plan_fields;
create policy plan_fields_insert on public.plan_fields for insert to authenticated with check (true);
drop policy if exists plan_fields_update on public.plan_fields;
create policy plan_fields_update on public.plan_fields for update to authenticated using (true) with check (true);
drop policy if exists plan_fields_delete on public.plan_fields;
create policy plan_fields_delete on public.plan_fields for delete to authenticated using (true);

drop policy if exists plan_values_select on public.plan_values;
create policy plan_values_select on public.plan_values for select to authenticated using (true);
drop policy if exists plan_values_insert on public.plan_values;
create policy plan_values_insert on public.plan_values for insert to authenticated with check (true);
drop policy if exists plan_values_update on public.plan_values;
create policy plan_values_update on public.plan_values for update to authenticated using (true) with check (true);
drop policy if exists plan_values_delete on public.plan_values;
create policy plan_values_delete on public.plan_values for delete to authenticated using (true);


-- ############################################################################
-- ### supabase/migrations/022_datasets_kpi_profile.sql
-- ############################################################################

-- 022_datasets_kpi_profile.sql — описывает миграцией колонку datasets.kpi_profile,
-- которую код уже читает и пишет (lib/supabase-db.ts). В живой БД колонка есть,
-- поэтому там это no-op; на чистой базе колонка появится. Идемпотентно,
-- ничего не удаляет и не меняет существующие данные.
alter table public.datasets
  add column if not exists kpi_profile jsonb not null default '{}'::jsonb;


-- ############################################################################
-- ### supabase/migrations/023_user_settings_theme_light.sql
-- ############################################################################

-- 023: тема по умолчанию — светлая (Arrow Mobile, стиль arwm.ru).
-- Раньше тёмная тема была зашита в разметку (class="dark" в app/layout), а
-- колонка user_settings.theme имела default 'dark' — это не был выбор
-- пользователя. Поэтому существующие 'dark' переводим в 'light' (решение
-- оркестратора); дальше 'dark' появляется только по явному переключению.
-- Идемпотентно: повторный запуск ничего не меняет. RLS user_settings
-- (auth.uid() = user_id) не трогаем — политики уже есть.

alter table public.user_settings
  alter column theme set default 'light';

update public.user_settings
  set theme = 'light'
  where theme = 'dark';


-- ############################################################################
-- ### supabase/migrations/024_sync_with_production_schema.sql
-- ############################################################################

-- 024: выравнивание схемы с рабочей базой.
--
-- Зачем: часть изменений в рабочую базу вносилась вручную (SQL Editor / MCP)
-- и не попала в миграции 001–023. На чистой базе после 001–023 схема заметно
-- отличалась от рабочей, и часть кода падала — например, вставка alert-правила
-- (нет schedule_type / schedule_config / timezone) и запуска алерта (нет
-- matches_count / message_sent / triggered_by, лишний NOT NULL rule_name).
--
-- Источник: метаданные схемы рабочей базы (information_schema / pg_catalog).
-- Идемпотентно: на рабочей базе — no-op, повторный запуск ничего не ломает.
--
-- Что сознательно НЕ переносится:
--   • email администратора в is_admin() — остаётся плейсхолдер из 017;
--   • public.rls_auto_enable() и event trigger ensure_rls — это настройка
--     платформы Supabase («Automatically enable RLS»), а не схема приложения.
--
-- ВНИМАНИЕ: удаляются колонки, которых нет в рабочей базе и которые код не
-- использует (alert_rules.schedule, alert_runs.matched_count / message /
-- rule_name / used_ai). На базе, где в них есть данные, данные пропадут.
-- alert_rules.schedule удалять обязательно: rowToSchedule() в
-- lib/alert-rules-helpers.ts сначала смотрит row.schedule, и при наличии
-- колонки (default '{}') расписание из schedule_type/schedule_config игнорируется.

-- ============================================================================
-- 1. Колонки
-- ============================================================================

-- Смена типа numeric → double precision только если тип ещё не тот
-- (чтобы не переписывать таблицу на рабочей базе).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'cost'
      AND table_name IN ('ai_analyses', 'ai_project_runs')
      AND udt_name <> 'float8'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN cost TYPE double precision USING cost::double precision', r.table_name);
  END LOOP;
END
$$;

-- Перед SET NOT NULL заполняем возможные NULL (на рабочей базе их нет).
UPDATE public.alert_rules SET description = '' WHERE description IS NULL;
UPDATE public.alert_rules SET tag_users = '' WHERE tag_users IS NULL;
UPDATE public.telegram_connections SET bot_username = '' WHERE bot_username IS NULL;
UPDATE public.telegram_connections SET chat_title = '' WHERE chat_title IS NULL;
UPDATE public.datasets SET business_context = '' WHERE business_context IS NULL;

-- ai_analyses
ALTER TABLE public.ai_analyses ADD COLUMN IF NOT EXISTS data_name text;
ALTER TABLE public.ai_analyses
  ALTER COLUMN cost DROP NOT NULL,
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN model SET DEFAULT 'sonnet'::text,
  ALTER COLUMN response DROP NOT NULL;

-- ai_project_runs
ALTER TABLE public.ai_project_runs
  ALTER COLUMN cost DROP NOT NULL,
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN filters_snapshot DROP NOT NULL,
  ALTER COLUMN input_tokens DROP NOT NULL,
  ALTER COLUMN model DROP NOT NULL,
  ALTER COLUMN output_tokens DROP NOT NULL,
  ALTER COLUMN response DROP NOT NULL;

-- ai_projects
ALTER TABLE public.ai_projects ADD COLUMN IF NOT EXISTS filters jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.ai_projects
  ALTER COLUMN builder_config SET DEFAULT '{}'::jsonb,
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN filter_values DROP NOT NULL,
  ALTER COLUMN filters_config DROP NOT NULL,
  ALTER COLUMN model DROP NOT NULL,
  ALTER COLUMN updated_at DROP NOT NULL;

-- alert_rules
ALTER TABLE public.alert_rules DROP COLUMN IF EXISTS schedule;
ALTER TABLE public.alert_rules ADD COLUMN IF NOT EXISTS ai_generation_meta jsonb;
ALTER TABLE public.alert_rules ADD COLUMN IF NOT EXISTS schedule_type text NOT NULL DEFAULT 'daily'::text;
ALTER TABLE public.alert_rules ADD COLUMN IF NOT EXISTS schedule_config jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Дефолт часового пояса взят из рабочей базы как есть. Приложение всегда пишет
-- timezone явно (FIXED_TIMEZONE в lib/alert-rules-helpers.ts — сейчас
-- 'Europe/Moscow'), так что дефолт срабатывает только при вставке в обход кода.
ALTER TABLE public.alert_rules ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Almaty'::text;
ALTER TABLE public.alert_rules ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.alert_rules
  ALTER COLUMN ai_meta SET DEFAULT '{}'::jsonb,
  ALTER COLUMN dataset_id DROP NOT NULL,
  ALTER COLUMN description SET DEFAULT ''::text,
  ALTER COLUMN description SET NOT NULL,
  ALTER COLUMN group_by SET DEFAULT ''::text,
  ALTER COLUMN period_days SET DEFAULT 3,
  ALTER COLUMN tag_users SET DEFAULT ''::text,
  ALTER COLUMN tag_users SET NOT NULL,
  ALTER COLUMN telegram_connection_id DROP NOT NULL,
  ALTER COLUMN template_id DROP NOT NULL;

-- alert_runs
ALTER TABLE public.alert_runs DROP COLUMN IF EXISTS matched_count;
ALTER TABLE public.alert_runs DROP COLUMN IF EXISTS message;
ALTER TABLE public.alert_runs DROP COLUMN IF EXISTS rule_name;
ALTER TABLE public.alert_runs DROP COLUMN IF EXISTS used_ai;
ALTER TABLE public.alert_runs ADD COLUMN IF NOT EXISTS matches_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.alert_runs ADD COLUMN IF NOT EXISTS message_sent text NOT NULL DEFAULT ''::text;
ALTER TABLE public.alert_runs ADD COLUMN IF NOT EXISTS triggered_by text NOT NULL DEFAULT 'manual'::text;
ALTER TABLE public.alert_runs
  ALTER COLUMN duration_ms DROP DEFAULT,
  ALTER COLUMN duration_ms DROP NOT NULL;

-- audit_log
ALTER TABLE public.audit_log
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN details SET DEFAULT '{}'::jsonb,
  ALTER COLUMN user_id DROP NOT NULL;

-- dashboard_sheets
ALTER TABLE public.dashboard_sheets
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN sort_order DROP NOT NULL;

-- dashboard_widgets
ALTER TABLE public.dashboard_widgets
  ALTER COLUMN config DROP NOT NULL,
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN sort_order DROP NOT NULL,
  ALTER COLUMN title DROP DEFAULT,
  ALTER COLUMN title DROP NOT NULL,
  ALTER COLUMN width DROP NOT NULL;

-- dashboards
ALTER TABLE public.dashboards
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN filters_config DROP NOT NULL,
  ALTER COLUMN updated_at DROP NOT NULL;

-- data_sources
ALTER TABLE public.data_sources ADD COLUMN IF NOT EXISTS tables_cache jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.data_sources
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN is_demo DROP NOT NULL,
  ALTER COLUMN password_encrypted DROP DEFAULT,
  ALTER COLUMN port SET DEFAULT 8443,
  ALTER COLUMN port DROP NOT NULL,
  ALTER COLUMN ssl DROP NOT NULL,
  ALTER COLUMN status SET DEFAULT 'connected'::text,
  ALTER COLUMN status DROP NOT NULL,
  ALTER COLUMN tables SET DEFAULT '[]'::jsonb,
  ALTER COLUMN updated_at DROP NOT NULL;

-- datasets
ALTER TABLE public.datasets ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.datasets
  ALTER COLUMN business_context SET DEFAULT ''::text,
  ALTER COLUMN business_context SET NOT NULL,
  ALTER COLUMN calculated_fields DROP NOT NULL,
  ALTER COLUMN columns DROP NOT NULL,
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN funnel_steps SET DEFAULT '[]'::jsonb,
  ALTER COLUMN row_count SET DEFAULT 0;

-- notification_templates
ALTER TABLE public.notification_templates ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.notification_templates
  ALTER COLUMN body SET DEFAULT ''::text,
  ALTER COLUMN parse_mode SET DEFAULT 'MarkdownV2'::text;

-- telegram_connections
ALTER TABLE public.telegram_connections ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.telegram_connections
  ALTER COLUMN bot_username SET DEFAULT ''::text,
  ALTER COLUMN bot_username SET NOT NULL,
  ALTER COLUMN chat_title SET DEFAULT ''::text,
  ALTER COLUMN chat_title SET NOT NULL;

-- user_settings
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS claude_api_key_encrypted text;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.user_settings
  ALTER COLUMN anthropic_api_key DROP DEFAULT,
  ALTER COLUMN anthropic_api_key DROP NOT NULL,
  ALTER COLUMN theme DROP NOT NULL,
  ALTER COLUMN updated_at DROP NOT NULL;

-- visualizations
ALTER TABLE public.visualizations ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.visualizations
  ALTER COLUMN config DROP NOT NULL,
  ALTER COLUMN created_at DROP NOT NULL;

-- ============================================================================
-- 2. Ограничения (FK / CHECK)
-- ============================================================================

-- В рабочей базе этих CHECK нет.
ALTER TABLE public.ai_analyses DROP CONSTRAINT IF EXISTS ai_analyses_data_type_check;
ALTER TABLE public.user_settings DROP CONSTRAINT IF EXISTS user_settings_theme_check;

-- Внешние ключи alert-таблиц (в 001 их не было; на них опираются каскады из 015
-- и embed alert_runs → alert_rules(name) в app/api/alert-runs/route.ts).
ALTER TABLE public.alert_rules DROP CONSTRAINT IF EXISTS alert_rules_telegram_connection_id_fkey;
ALTER TABLE public.alert_rules
  ADD CONSTRAINT alert_rules_telegram_connection_id_fkey
  FOREIGN KEY (telegram_connection_id) REFERENCES public.telegram_connections(id) ON DELETE SET NULL;

ALTER TABLE public.alert_rules DROP CONSTRAINT IF EXISTS alert_rules_template_id_fkey;
ALTER TABLE public.alert_rules
  ADD CONSTRAINT alert_rules_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES public.notification_templates(id) ON DELETE SET NULL;

ALTER TABLE public.alert_runs DROP CONSTRAINT IF EXISTS alert_runs_rule_id_fkey;
ALTER TABLE public.alert_runs
  ADD CONSTRAINT alert_runs_rule_id_fkey
  FOREIGN KEY (rule_id) REFERENCES public.alert_rules(id) ON DELETE CASCADE;

-- audit_log: при удалении пользователя журнал сохраняется (SET NULL, не CASCADE).
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- 3. Индексы
-- ============================================================================

-- Дубли / индексы, которых нет в рабочей базе.
DROP INDEX IF EXISTS public.ai_analyses_created_at_idx;
DROP INDEX IF EXISTS public.ai_analyses_user_id_idx;
DROP INDEX IF EXISTS public.ai_project_runs_project_id_idx;
DROP INDEX IF EXISTS public.ai_project_runs_user_id_idx;
DROP INDEX IF EXISTS public.ai_projects_updated_at_idx;
DROP INDEX IF EXISTS public.ai_projects_user_id_idx;
DROP INDEX IF EXISTS public.idx_alert_rules_next_run_active;
DROP INDEX IF EXISTS public.idx_alert_rules_user_id;
DROP INDEX IF EXISTS public.idx_alert_runs_created_at;
DROP INDEX IF EXISTS public.idx_alert_runs_rule_id;
DROP INDEX IF EXISTS public.idx_alert_runs_user_id;
DROP INDEX IF EXISTS public.audit_log_user_id_created_at_idx;
DROP INDEX IF EXISTS public.dashboard_sheets_dashboard_id_idx;
DROP INDEX IF EXISTS public.dashboard_widgets_sheet_id_idx;
DROP INDEX IF EXISTS public.dashboards_user_id_idx;
DROP INDEX IF EXISTS public.data_sources_user_id_idx;
DROP INDEX IF EXISTS public.datasets_data_source_id_idx;
DROP INDEX IF EXISTS public.datasets_user_id_idx;
DROP INDEX IF EXISTS public.idx_notification_templates_user_id;
DROP INDEX IF EXISTS public.idx_telegram_connections_user_id;
DROP INDEX IF EXISTS public.visualizations_dataset_id_idx;
DROP INDEX IF EXISTS public.visualizations_user_id_idx;

-- Индексы рабочей базы.
CREATE INDEX IF NOT EXISTS alert_rules_user_id_idx ON public.alert_rules USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_rules_active_next ON public.alert_rules USING btree (is_active, next_run_at) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS alert_runs_rule_id_idx ON public.alert_runs USING btree (rule_id);
CREATE INDEX IF NOT EXISTS alert_runs_user_id_idx ON public.alert_runs USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_runs_rule ON public.alert_runs USING btree (rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_templates_user_id_idx ON public.notification_templates USING btree (user_id);
CREATE INDEX IF NOT EXISTS telegram_connections_user_id_idx ON public.telegram_connections USING btree (user_id);

-- ============================================================================
-- 4. RLS-политики
-- ============================================================================
-- В рабочей базе для большинства таблиц одна политика FOR ALL вместо четырёх
-- раздельных, а у alert/telegram/notification — другие имена и роль public.

-- Удаляем политики из schema-*.sql и 001, которых нет в рабочей базе.
DROP POLICY IF EXISTS "Users can view own ai_analyses" ON public.ai_analyses;
DROP POLICY IF EXISTS "Users can insert own ai_analyses" ON public.ai_analyses;
DROP POLICY IF EXISTS "Users can delete own ai_analyses" ON public.ai_analyses;
DROP POLICY IF EXISTS "Users can view own ai_project_runs" ON public.ai_project_runs;
DROP POLICY IF EXISTS "Users can insert own ai_project_runs" ON public.ai_project_runs;
DROP POLICY IF EXISTS "Users can delete own ai_project_runs" ON public.ai_project_runs;
DROP POLICY IF EXISTS "Users can view own ai_projects" ON public.ai_projects;
DROP POLICY IF EXISTS "Users can insert own ai_projects" ON public.ai_projects;
DROP POLICY IF EXISTS "Users can update own ai_projects" ON public.ai_projects;
DROP POLICY IF EXISTS "Users can delete own ai_projects" ON public.ai_projects;
DROP POLICY IF EXISTS "Users can view own audit_log" ON public.audit_log;
DROP POLICY IF EXISTS "Users can insert own audit_log" ON public.audit_log;
DROP POLICY IF EXISTS "Users can view own dashboard_sheets" ON public.dashboard_sheets;
DROP POLICY IF EXISTS "Users can insert own dashboard_sheets" ON public.dashboard_sheets;
DROP POLICY IF EXISTS "Users can update own dashboard_sheets" ON public.dashboard_sheets;
DROP POLICY IF EXISTS "Users can delete own dashboard_sheets" ON public.dashboard_sheets;
DROP POLICY IF EXISTS "Users can view own dashboard_widgets" ON public.dashboard_widgets;
DROP POLICY IF EXISTS "Users can insert own dashboard_widgets" ON public.dashboard_widgets;
DROP POLICY IF EXISTS "Users can update own dashboard_widgets" ON public.dashboard_widgets;
DROP POLICY IF EXISTS "Users can delete own dashboard_widgets" ON public.dashboard_widgets;
DROP POLICY IF EXISTS "Users can view own dashboards" ON public.dashboards;
DROP POLICY IF EXISTS "Users can insert own dashboards" ON public.dashboards;
DROP POLICY IF EXISTS "Users can update own dashboards" ON public.dashboards;
DROP POLICY IF EXISTS "Users can delete own dashboards" ON public.dashboards;
DROP POLICY IF EXISTS "Users can view own data_sources" ON public.data_sources;
DROP POLICY IF EXISTS "Users can insert own data_sources" ON public.data_sources;
DROP POLICY IF EXISTS "Users can update own data_sources" ON public.data_sources;
DROP POLICY IF EXISTS "Users can delete own data_sources" ON public.data_sources;
DROP POLICY IF EXISTS "Users can view own datasets" ON public.datasets;
DROP POLICY IF EXISTS "Users can insert own datasets" ON public.datasets;
DROP POLICY IF EXISTS "Users can update own datasets" ON public.datasets;
DROP POLICY IF EXISTS "Users can delete own datasets" ON public.datasets;
DROP POLICY IF EXISTS "Users can view own user_settings" ON public.user_settings;
DROP POLICY IF EXISTS "Users can insert own user_settings" ON public.user_settings;
DROP POLICY IF EXISTS "Users can update own user_settings" ON public.user_settings;
DROP POLICY IF EXISTS "Users can view own visualizations" ON public.visualizations;
DROP POLICY IF EXISTS "Users can insert own visualizations" ON public.visualizations;
DROP POLICY IF EXISTS "Users can update own visualizations" ON public.visualizations;
DROP POLICY IF EXISTS "Users can delete own visualizations" ON public.visualizations;
DROP POLICY IF EXISTS "telegram_connections_select_own" ON public.telegram_connections;
DROP POLICY IF EXISTS "telegram_connections_insert_own" ON public.telegram_connections;
DROP POLICY IF EXISTS "telegram_connections_update_own" ON public.telegram_connections;
DROP POLICY IF EXISTS "telegram_connections_delete_own" ON public.telegram_connections;
DROP POLICY IF EXISTS "notification_templates_select_own" ON public.notification_templates;
DROP POLICY IF EXISTS "notification_templates_insert_own" ON public.notification_templates;
DROP POLICY IF EXISTS "notification_templates_update_own" ON public.notification_templates;
DROP POLICY IF EXISTS "notification_templates_delete_own" ON public.notification_templates;
DROP POLICY IF EXISTS "alert_rules_select_own" ON public.alert_rules;
DROP POLICY IF EXISTS "alert_rules_insert_own" ON public.alert_rules;
DROP POLICY IF EXISTS "alert_rules_update_own" ON public.alert_rules;
DROP POLICY IF EXISTS "alert_rules_delete_own" ON public.alert_rules;
DROP POLICY IF EXISTS "alert_runs_select_own" ON public.alert_runs;
DROP POLICY IF EXISTS "alert_runs_insert_own" ON public.alert_runs;
DROP POLICY IF EXISTS "alert_runs_update_own" ON public.alert_runs;
DROP POLICY IF EXISTS "alert_runs_delete_own" ON public.alert_runs;

-- Политики «одна на таблицу» (FOR ALL).
DROP POLICY IF EXISTS "Users manage own ai_analyses" ON public.ai_analyses;
CREATE POLICY "Users manage own ai_analyses" ON public.ai_analyses FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own ai_project_runs" ON public.ai_project_runs;
CREATE POLICY "Users manage own ai_project_runs" ON public.ai_project_runs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own ai_projects" ON public.ai_projects;
CREATE POLICY "Users manage own ai_projects" ON public.ai_projects FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own dashboards" ON public.dashboards;
CREATE POLICY "Users manage own dashboards" ON public.dashboards FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own data_sources" ON public.data_sources;
CREATE POLICY "Users manage own data_sources" ON public.data_sources FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own datasets" ON public.datasets;
CREATE POLICY "Users manage own datasets" ON public.datasets FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own settings" ON public.user_settings;
CREATE POLICY "Users manage own settings" ON public.user_settings FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own visualizations" ON public.visualizations;
CREATE POLICY "Users manage own visualizations" ON public.visualizations FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own sheets" ON public.dashboard_sheets;
CREATE POLICY "Users manage own sheets" ON public.dashboard_sheets FOR ALL
  USING (EXISTS (SELECT 1 FROM public.dashboards
                 WHERE dashboards.id = dashboard_sheets.dashboard_id AND dashboards.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.dashboards
                 WHERE dashboards.id = dashboard_sheets.dashboard_id AND dashboards.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own widgets" ON public.dashboard_widgets;
CREATE POLICY "Users manage own widgets" ON public.dashboard_widgets FOR ALL
  USING (EXISTS (SELECT 1 FROM public.dashboard_sheets s JOIN public.dashboards d ON d.id = s.dashboard_id
                 WHERE s.id = dashboard_widgets.sheet_id AND d.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.dashboard_sheets s JOIN public.dashboards d ON d.id = s.dashboard_id
                 WHERE s.id = dashboard_widgets.sheet_id AND d.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users view own audit log" ON public.audit_log;
CREATE POLICY "Users view own audit log" ON public.audit_log FOR SELECT
  USING (auth.uid() = user_id);

-- alert_rules / alert_runs / notification_templates / telegram_connections:
-- в рабочей базе два набора политик с одинаковым смыслом (OR) — переносим оба.
DROP POLICY IF EXISTS alert_rules_select ON public.alert_rules;
CREATE POLICY alert_rules_select ON public.alert_rules FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS alert_rules_insert ON public.alert_rules;
CREATE POLICY alert_rules_insert ON public.alert_rules FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS alert_rules_update ON public.alert_rules;
CREATE POLICY alert_rules_update ON public.alert_rules FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS alert_rules_delete ON public.alert_rules;
CREATE POLICY alert_rules_delete ON public.alert_rules FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS rules_own_select ON public.alert_rules;
CREATE POLICY rules_own_select ON public.alert_rules FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS rules_own_insert ON public.alert_rules;
CREATE POLICY rules_own_insert ON public.alert_rules FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS rules_own_update ON public.alert_rules;
CREATE POLICY rules_own_update ON public.alert_rules FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS rules_own_delete ON public.alert_rules;
CREATE POLICY rules_own_delete ON public.alert_rules FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS alert_runs_select ON public.alert_runs;
CREATE POLICY alert_runs_select ON public.alert_runs FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS alert_runs_insert ON public.alert_runs;
CREATE POLICY alert_runs_insert ON public.alert_runs FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS runs_own_select ON public.alert_runs;
CREATE POLICY runs_own_select ON public.alert_runs FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS runs_own_insert ON public.alert_runs;
CREATE POLICY runs_own_insert ON public.alert_runs FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS notification_templates_select ON public.notification_templates;
CREATE POLICY notification_templates_select ON public.notification_templates FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS notification_templates_insert ON public.notification_templates;
CREATE POLICY notification_templates_insert ON public.notification_templates FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS notification_templates_update ON public.notification_templates;
CREATE POLICY notification_templates_update ON public.notification_templates FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS notification_templates_delete ON public.notification_templates;
CREATE POLICY notification_templates_delete ON public.notification_templates FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS tpl_own_select ON public.notification_templates;
CREATE POLICY tpl_own_select ON public.notification_templates FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS tpl_own_insert ON public.notification_templates;
CREATE POLICY tpl_own_insert ON public.notification_templates FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS tpl_own_update ON public.notification_templates;
CREATE POLICY tpl_own_update ON public.notification_templates FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS tpl_own_delete ON public.notification_templates;
CREATE POLICY tpl_own_delete ON public.notification_templates FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS telegram_connections_select ON public.telegram_connections;
CREATE POLICY telegram_connections_select ON public.telegram_connections FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS telegram_connections_insert ON public.telegram_connections;
CREATE POLICY telegram_connections_insert ON public.telegram_connections FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS telegram_connections_update ON public.telegram_connections;
CREATE POLICY telegram_connections_update ON public.telegram_connections FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS telegram_connections_delete ON public.telegram_connections;
CREATE POLICY telegram_connections_delete ON public.telegram_connections FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS tg_own_select ON public.telegram_connections;
CREATE POLICY tg_own_select ON public.telegram_connections FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS tg_own_insert ON public.telegram_connections;
CREATE POLICY tg_own_insert ON public.telegram_connections FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS tg_own_update ON public.telegram_connections;
CREATE POLICY tg_own_update ON public.telegram_connections FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS tg_own_delete ON public.telegram_connections;
CREATE POLICY tg_own_delete ON public.telegram_connections FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- 5. Триггеры и функции
-- ============================================================================

-- updated_at через общую set_updated_at().
DROP TRIGGER IF EXISTS rules_set_updated_at ON public.alert_rules;
CREATE TRIGGER rules_set_updated_at BEFORE UPDATE ON public.alert_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS tpl_set_updated_at ON public.notification_templates;
CREATE TRIGGER tpl_set_updated_at BEFORE UPDATE ON public.notification_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS tg_set_updated_at ON public.telegram_connections;
CREATE TRIGGER tg_set_updated_at BEFORE UPDATE ON public.telegram_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Триггера и функции из schema-fix-datasources.sql в рабочей базе нет
-- (updated_at источника пишет приложение — lib/supabase-db.ts).
DROP TRIGGER IF EXISTS data_sources_set_updated_at ON public.data_sources;
DROP FUNCTION IF EXISTS public.set_updated_at_column();

NOTIFY pgrst, 'reload schema';

-- Конец setup.sql
