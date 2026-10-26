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
