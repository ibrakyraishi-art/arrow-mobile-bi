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
