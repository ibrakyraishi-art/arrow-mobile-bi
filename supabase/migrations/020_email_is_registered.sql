-- 020: проверка «email уже зарегистрирован» для формы регистрации.
-- Применено к prod через MCP; здесь для воспроизводимости. Идемпотентно
-- (create or replace).
--
-- Зачем: при повторной регистрации НЕподтверждённого email Supabase просто
-- ПЕРЕ-отправляет письмо и возвращает непустой `identities` → клиентская
-- проверка `identities.length === 0` (срабатывает только для ПОДТВЕРЖДённых)
-- не ловила это, и пользователь видел «письмо отправлено» вместо
-- «этот email уже зарегистрирован».
--
-- Решение: SECURITY DEFINER функция, возвращающая ТОЛЬКО boolean (без утечки
-- каких-либо данных), читает `auth.users` (источник истины — там и
-- неподтверждённые). Клиент дёргает её перед signUp.
--
-- Компромисс безопасности: это включает email enumeration (можно проверить,
-- занят ли email). Осознанно — это нужная UX при регистрации, и сам signUp
-- уже частично это раскрывает.

create or replace function public.email_is_registered(p_email text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where lower(u.email) = lower(trim(p_email))
  );
$$;

revoke all on function public.email_is_registered(text) from public;
grant execute on function public.email_is_registered(text) to anon, authenticated;
