# Security — чек-лист и статус

Аудит проведён в Сессии 76. Стек: Next.js (App Router) + Supabase (Postgres, RLS)
+ ClickHouse (внешний источник данных пользователя). Деплой — Vercel.

Легенда: ✅ сделано · ⚠️ требует ручного действия (вне кода) · ⏭️ отложено осознанно.

## Режим конфиденциальности AI-анализа (NDA) — Сессия 77

При включённом режиме реальные нейминги клиента **не покидают сервер в открытом
виде** при обращении к Claude:

- **Что уходит в Anthropic.** Только токенизированные данные: в CSV значения
  конфиденциальных столбцов заменены на коды (`SRC_01`), и так же замаскированы
  все текстовые поля тела запроса — `prompt`, `systemTemplate`, `businessContext`,
  `additionalContext`, описания столбцов, лейблы воронки и **значения фильтров**.
  Реальные имена и сам словарь в Anthropic **не передаются никогда** (проверено
  по телу запроса: `system` и `messages` строятся из замаскированных данных).
- **Словарь замен** (реальное ↔ код) — самое ценное. Хранится в таблице
  `ai_anonymization_maps`, **зашифрован AES** (`lib/encryption.ts`, ключ
  `ENCRYPTION_KEY` только на сервере), 1 строка на проект, под **RLS**
  (`auth.uid() = user_id`). Модули токенизации (`lib/anonymize.ts`,
  `lib/anonymize-store.ts`) помечены `import "server-only"` — в браузер не попадут.
- **Обратная замена** код → реальное имя делается на сервере в SSE-стриме
  (буфер на случай разрыва кода между чанками). Пользователь видит реальные
  имена; в историю (`ai_project_runs`) и экспорт сохраняется реальная версия.
- **Граница доверия.** Реальные строки идут клиент → НАШ сервер (как и раньше —
  клиент и так отправлял реальный CSV нам). Новое и главное: с НАШЕГО сервера в
  Anthropic уходят только коды.
- **Выключенный режим** (по умолчанию для всех старых проектов) — тело запроса к
  Anthropic байт-в-байт как раньше, никакой токенизации.
- Ограничение: маскируются только столбцы, отмеченные пользователем. Кнопка
  «Предпросмотр» показывает, что именно увидит AI, чтобы поймать забытый столбец.

## Админка и обратная связь — 2026-06-05

Новые объекты (миграция `017_admin_feedback.sql`) и админ-функции. Принципы:

- **Админ — РОВНО одна почта.** Источник истины — серверная переменная `ADMIN_EMAIL`
  (фоллбэк в `lib/admin.ts` — `server-only` — на известный адрес владельца, чтобы фича
  работала до настройки env; email не секрет, реальный гейт — серверный). Проверка во
  ВСЕХ точках на сервере: админ-роуты (`getAdmin()` → 403 не-админу), серверная страница
  `/admin` (не-админ → `redirect('/')`), RLS-функция `public.is_admin()`
  (`auth.jwt()->>'email'`, `set search_path=''`). Скрытие пункта меню (`/api/admin/check`)
  — лишь косметика, не источник прав.
- **`public.feedback` под RLS:** SELECT — автор (`auth.uid()=user_id`) или админ
  (`is_admin()`); INSERT — только своё; UPDATE/DELETE (статус/ответ/удаление) — только
  админ. `user_id` → `auth.users ON DELETE CASCADE`. Индексы на `user_id/status/created_at`.
- **Скриншоты — приватный бакет `feedback-screenshots`** без публичных политик. Доступ
  ТОЛЬКО через серверные роуты: загрузка валидируется (PNG-data-URL, ≤4 МБ) и идёт
  service-role в `{user_id}/…`; чтение — короткоживущий signed URL (10 мин), выдаётся лишь
  для строк, видимых запросившему по RLS. Публично не читается.
- **service-role** (обходит RLS) — ТОЛЬКО для `auth.users` (список/удаление — admin API)
  и загрузки/подписи скриншотов; всё — в роутах под `getAdmin()`. Чтение/правка заявок
  админом — RLS-клиентом под `is_admin()` (минимум service-role).
- **Удаление пользователя** (`DELETE /api/admin/users/[id]`, только админ):
  `auth.admin.deleteUser` (service-role) → каскад по FK; нельзя удалить себя и учётку с
  админ-почтой; скриншоты Storage чистятся явно (FK их не каскадит).
- **Валидация на сервере:** длина комментария ≤5000, статус — enum, размер/тип скриншота;
  `user_id`/`email` берутся из сессии, не из тела (нельзя подменить).
- Supabase Security Advisor после миграции: **0 ERROR**.

## КРИТИЧНО

1. **RLS на всех таблицах** — ✅ RLS включён на всех 16 таблицах `public`, у каждой
   есть политики. Все политики (кроме одной, см. ниже) scoped на `auth.uid() = user_id`.
   `audit_log` INSERT был `WITH CHECK (true)` → заменён на
   `auth.uid() IS NOT NULL AND auth.uid() = user_id` (миграция
   `008_security_hardening`). Индексы на `user_id` добавлены для 8 таблиц, где их не было.
   **Supabase Security Advisor: 0 ERROR.**
2. **service_role только на сервере** — ✅ вынесен в `lib/supabase/admin.ts` с
   `import "server-only"` в первой строке. Используется только в `app/api/cron/*`.
   Проверено `grep` по `.next/static`: ключа в браузерном бандле нет.
3. **Нет секретов в браузере** — ✅ `NEXT_PUBLIC_*` содержат только URL и anon
   (publishable) ключ Supabase — оба публичны по дизайну. Bot-токены Telegram
   хранятся AES-зашифрованными (`ENCRYPTION_KEY`), расшифровка только server-side.
4. **CVE-2025-29927 (Next.js middleware bypass)** — ✅ Next 14.2.18 → **14.2.35**
   (патч включён). Middleware в проекте НЕТ; авторизация в каждом роуте — сама
   (`getAuthenticatedUser()` → `supabase.auth.getUser()`, проверяет подпись JWT,
   не `getSession()`).
5. **Telegram-вебхук** — ⏭️ Входящего вебхука НЕТ (все `app/api/telegram/*` —
   исходящие: verify/test/list). Добавлять нечего. На будущее: helper
   `lib/secure-compare.ts` (`secureEquals`/`bearerMatches`) на `timingSafeEqual`.
   Cron-секрет теперь сравнивается constant-time.
6. **Data Access Layer** — ◑ Частично. Все обращения к БД уже идут через серверные
   модули с `server-only` (`lib/server-auth.ts`, `lib/alert-*.ts`,
   `lib/supabase-db.ts`) и проверкой `getUser()`. Отдельной директории `lib/dal/*`
   нет — текущая структура эквивалентна по гарантиям; вынос в `lib/dal/*` отложен
   как рефактор без выигрыша в безопасности.
7. **Git/секреты** — ✅ `.gitignore` покрывает `.env`, `.env*.local`, `.vercel`.
   В истории и трекнутых файлах **захардкоженных секретов не найдено** (только
   упоминания имён переменных в доках). Ротация ключей НЕ требуется.

## ВЫСОКИЙ ПРИОРИТЕТ

8. **Security-заголовки** — ✅ `next.config.js`: HSTS, X-Frame-Options: DENY,
   X-Content-Type-Options, Referrer-Policy, Permissions-Policy, `poweredByHeader:false`
   (убран X-Powered-By). CSP — в режиме **Report-Only** (`connect-src` включает
   `https://*.supabase.co` и `wss://*.supabase.co`; `api.telegram.org` НЕ добавлен —
   он серверный). Переключить на enforce после анализа отчётов.
9. **Валидация входов (Zod .strict())** — ⏭️ Сейчас входы валидируются вручную
   (`normalizeXxx`, явные проверки полей). Mass-assignment закрыт тем, что роуты
   читают только известные поля и `user_id` всегда берётся из сессии, не из тела
   (нельзя подменить). Перевод на Zod `.strict()` — улучшение, отложено (нет `zod`
   в зависимостях; добавление — отдельный PR).
10. **Rate limiting** — ◑ Есть `lib/rate-limit.ts` (in-memory), применён на
    `/api/alert-rules/preview`. Логин/регистрация — на стороне Supabase Auth
    (встроенный throttling). Вебхука нет.
11. **Ошибки наружу** — ✅ Telegram-verify больше НЕ возвращает клиенту
    `details`/`supabase` (код/hint/message БД) — только понятное сообщение + шаг;
    детали идут в серверный лог. Логин: единый ответ обеспечивает Supabase Auth.
12. **Логи без PII** — ◑ Токены/сессии не логируются; bot-токен только в
    зашифрованном виде. Email фигурирует в некоторых серверных логах cron —
    допустимо (server-side), но помечено к ревизии.

## СРЕДНИЙ ПРИОРИТЕТ

13. **npm/зависимости** — ✅ `.npmrc` с `ignore-scripts=true`. Dependabot
    (`.github/dependabot.yml`) с `cooldown: 3 дня`. `npm audit fix` (non-breaking)
    применён. **Осталось 5 advisory (4 high/1 moderate)**, все требуют Next 16 /
    eslint-config-next 16 (major, breaking) — отложено как отдельная миграция,
    см. ниже.
14. **Postgres views/функции** — ✅ `handle_new_user` и `set_updated_at` получили
    `SET search_path = ''`; `handle_new_user`/`rls_auto_enable` — `REVOKE EXECUTE`
    от anon/authenticated (не вызвать через RPC). Вьюх в схеме нет.
15. **Vercel preview protection** — ⚠️ Проверить в дашборде Vercel: Deployment
    Protection включён, preview не наследует production-секреты. (Вне кода.)

## ⚠️ Требует ручного действия (вне репозитория)

- **Supabase → Auth → Leaked Password Protection**: включить (HaveIBeenPwned).
  Единственный оставшийся WARN в Security Advisor.
- **Vercel → Settings → Deployment Protection**: убедиться, что включено и
  preview-окружения не имеют production-секретов.

## ⏭️ Отложено (отдельным PR, ломающие/крупные)

- **Next.js 14 → 16**: закрывает оставшиеся 5 npm-advisory (DoS Image Optimizer,
  RSC DoS, request smuggling в rewrites, postcss XSS, glob в eslint-plugin).
  На линии 14.2.x патчей больше нет — нужен мажорный апгрейд с регрессионным
  тестированием. Текущая 14.2.35 — последняя патч-версия 14.2.
- **Zod-валидация со `.strict()`** на всех роутах (#9).
- **`lib/dal/*`** как явный слой (#6) — косметика поверх уже-серверных модулей.

## Захардкоженные секреты

Не найдено. Ротация ключей не требуется.
