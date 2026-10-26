-- 023: тема по умолчанию — светлая (Arrow Mobile, стиль arwm.ru).
-- Раньше тёмная тема была зашита в разметку (class="dark" в app/layout), а
-- колонка user_settings.theme имела default 'dark' — это не был выбор
-- пользователя. Поэтому существующие 'dark' переводим в 'light' (решение
-- оркестратора); дальше 'dark' появляется только по явному переключению.
-- Идемпотентно: повторный запуск ничего не меняет. RLS user_settings
-- (auth.uid() = user_id) не трогаем — политики уже есть.

alter table public.user_settings
  alter column theme set default 'light';

update public.user_settings
  set theme = 'light'
  where theme = 'dark';
