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
