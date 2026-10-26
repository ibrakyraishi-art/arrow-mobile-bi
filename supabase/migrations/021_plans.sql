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
