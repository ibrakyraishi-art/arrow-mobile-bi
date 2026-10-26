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
