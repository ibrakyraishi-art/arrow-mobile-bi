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
