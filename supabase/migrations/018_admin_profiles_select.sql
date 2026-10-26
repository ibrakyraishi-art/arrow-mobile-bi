-- 018_admin_profiles_select.sql — админ видит все профили (для списка
-- пользователей в админке) ЧЕРЕЗ RLS, без service-role.
-- Дополнительная SELECT-политика поверх «свой профиль»; политики объединяются
-- по OR, поэтому обычный пользователь по-прежнему видит только себя.
-- Старая политика из schema.sql «Admins can view all profiles» читает
-- public.profiles внутри политики на public.profiles → Postgres отвечает
-- «infinite recursion detected in policy for relation "profiles"» на ЛЮБОЙ
-- SELECT профилей под ролью authenticated (в т.ч. «свой профиль»). Её роль
-- (админ видит всех) берёт на себя profiles_admin_select ниже — удаляем.
drop policy if exists "Admins can view all profiles" on public.profiles;
drop policy if exists profiles_admin_select on public.profiles;
create policy profiles_admin_select on public.profiles for select
  using (public.is_admin());
