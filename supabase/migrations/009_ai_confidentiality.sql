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
