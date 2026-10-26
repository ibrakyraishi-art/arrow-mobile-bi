-- 022_datasets_kpi_profile.sql — описывает миграцией колонку datasets.kpi_profile,
-- которую код уже читает и пишет (lib/supabase-db.ts). В живой БД колонка есть,
-- поэтому там это no-op; на чистой базе колонка появится. Идемпотентно,
-- ничего не удаляет и не меняет существующие данные.
alter table public.datasets
  add column if not exists kpi_profile jsonb not null default '{}'::jsonb;
