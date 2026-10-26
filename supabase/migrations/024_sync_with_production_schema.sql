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
