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
