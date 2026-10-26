# Arrow Mobile — BI-платформа с план/фактом и AI-анализом

Веб-сервис для медиабайеров и аналитиков: подключение источников данных, датасеты,
сводные таблицы и графики, дашборды, план/факт, AI-анализ данных и уведомления в Telegram.

Репозиторий содержит **только код сервиса**. Никаких серверов, баз данных, ключей и
пользовательских данных в нём нет — компания разворачивает сервис на **своей**
инфраструктуре по инструкции ниже.

---

## Возможности

- **Источники данных** — ClickHouse (HTTP/HTTPS), Google Sheets по ссылке, загрузка CSV/Excel.
- **Датасеты** — выбор таблицы или SQL, типы колонок, вычисляемые поля, описания для AI.
- **Визуализация** — сводные таблицы и графики (Recharts), фильтры, экспорт в Excel/PNG/PDF.
- **Дашборды** — листы, виджеты, глобальные фильтры и период.
- **План/факт** — плановые значения поверх датасета, темп выполнения, отчёт.
- **AI-анализ** — Claude, OpenAI, Gemini, Groq, Cerebras, Mistral. Ключи каждый
  пользователь вводит сам в «Настройках» (BYOK), они хранятся в БД зашифрованными.
  Есть режим конфиденциальности: реальные названия заменяются кодами до отправки в LLM.
- **Уведомления в Telegram** — правила по метрикам, шаблоны сообщений, запуск по расписанию.
- **Админка** — пользователи и обращения «Сообщить о проблеме».
- **Демо-режим** — встроенные синтетические данные, работает без внешних источников.

## Технологии

Next.js 14 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Zustand · Recharts ·
Supabase (Postgres + Auth + Storage, RLS) · деплой на Vercel.

---

## Что компания должна подключить сама

| Что | Зачем | Обязательно |
|-----|-------|-------------|
| **Проект Supabase** | База данных, регистрация/вход, хранилище скриншотов | Да |
| **Хостинг Next.js** (рекомендуется Vercel) | Сам сайт + cron для уведомлений | Да |
| **Домен** | Адрес сервиса | Желательно (подойдёт и `*.vercel.app`) |
| **SMTP-провайдер** | Письма подтверждения регистрации и сброса пароля | Желательно для продакшена¹ |
| **6 переменных окружения** | См. `.env.example` | Да |

¹ Встроенная почта Supabase имеет жёсткий лимит писем в час и подходит только для теста.

Ключи LLM-провайдеров, ClickHouse и Telegram-ботов **не нужны на уровне сервера** —
каждый пользователь вводит свои в интерфейсе.

---

## Пошаговая установка

### Шаг 1. Создать проект Supabase

1. Зарегистрироваться на [supabase.com](https://supabase.com) и создать новый проект
   (регион — например, `eu-west-1`; он совпадает с регионом функций в `vercel.json`).
2. Открыть **SQL Editor → New query**.
3. Открыть файл [`supabase/setup.sql`](supabase/setup.sql) и **заменить
   `admin@your-company.com`** на email будущего администратора сервиса
   (функция `public.is_admin()`).
4. Вставить весь файл в SQL Editor и нажать **Run**. Скрипт создаёт все таблицы,
   политики безопасности (RLS), функции, триггеры и приватный бакет
   `feedback-screenshots`.

> Отдельные файлы `supabase/schema*.sql` и `supabase/migrations/*.sql` — это та же
> схема, разбитая по этапам разработки. Для новой установки достаточно `setup.sql`.

### Шаг 2. Настроить авторизацию в Supabase

**Authentication → URL Configuration:**
- **Site URL**: `https://<ваш-домен>`
- **Redirect URLs** — добавить:
  - `https://<ваш-домен>/login`
  - `https://<ваш-домен>/auth/confirm`
  - `https://<ваш-домен>/update-password`
  - для локальной разработки то же самое с `http://localhost:3000`

**Authentication → Emails (SMTP Settings):** подключить свой SMTP
(отправитель вида `noreply@<ваш-домен>`, домен с SPF/DKIM).

**Authentication → Email Templates** (рекомендуется — так ссылки из писем
обрабатывает сам сервис на странице `/auth/confirm`):
- *Confirm signup* — ссылка:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`
- *Reset password* — ссылка:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`

### Шаг 3. Взять ключи Supabase

**Project Settings → API**:
- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` / publishable key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` / secret key → `SUPABASE_SERVICE_ROLE_KEY` (**секрет, только на сервер**)

### Шаг 4. Сгенерировать секреты

```bash
openssl rand -hex 32   # → ENCRYPTION_KEY (ровно 64 hex-символа)
openssl rand -hex 32   # → CRON_SECRET
```

`ENCRYPTION_KEY` шифрует пароли ClickHouse, API-ключи и токены Telegram в базе.
Храните его в надёжном месте: **если ключ потерять или сменить, сохранённые секреты
пользователей перестанут расшифровываться** (их придётся ввести заново).

### Шаг 5. Задеплоить на Vercel

1. Сделать форк/копию этого репозитория в GitHub компании.
2. [vercel.com](https://vercel.com) → **Add New → Project** → импортировать репозиторий
   (фреймворк Next.js определится сам).
3. **Settings → Environment Variables** (Production, при желании и Preview):

   | Переменная | Значение |
   |------------|----------|
   | `NEXT_PUBLIC_SUPABASE_URL` | из шага 3 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | из шага 3 |
   | `SUPABASE_SERVICE_ROLE_KEY` | из шага 3 |
   | `ENCRYPTION_KEY` | из шага 4 |
   | `CRON_SECRET` | из шага 4 |
   | `ADMIN_EMAIL` | тот же email, что в `public.is_admin()` в шаге 1 |

4. **Deploy**. Затем при необходимости подключить домен (**Settings → Domains**)
   и обновить Site URL / Redirect URLs в Supabase (шаг 2).

**Cron.** В `vercel.json` описаны два расписания:
- `/api/cron/alert-rules` — раз в сутки (06:00 UTC) запускает правила Telegram-уведомлений.
  Vercel сам передаёт `Authorization: Bearer <CRON_SECRET>`; без верного секрета эндпоинт отвечает 401.
- `/api/ping` — раз в сутки «будит» базу, чтобы бесплатный проект Supabase не уходил в паузу.

На бесплатном тарифе Vercel cron запускается не чаще раза в сутки; чтобы уведомления
приходили чаще, нужен тариф Pro (и поменять `schedule` в `vercel.json`).

### Шаг 6. Первый вход

1. Открыть сайт → **Регистрация** с email администратора → подтвердить почту.
2. В меню появится **Админка**.
3. Каждый пользователь в **Настройках** вводит свой ключ LLM-провайдера для AI-анализа.

---

## Локальный запуск

Нужен Node.js 20+.

```bash
cp .env.example .env.local   # заполнить значениями
npm install
npm run dev                  # http://localhost:3000
```

Проверки:

```bash
npm run check          # tsc + eslint + production build
npm run test:plan      # юнит-тесты план/факт
npm run test:anonymize # тесты анонимизации
```

> В `.npmrc` включено `ignore-scripts=true` (защита от вредоносных install-скриптов
> зависимостей). Если какой-то пакет потребует postinstall — выполните его вручную.

---

## Другой хостинг вместо Vercel

Сервис — обычное Next.js-приложение (`npm run build && npm run start`), его можно
запустить на любом сервере с Node.js 20+ или в Docker. В этом случае:
- задайте те же переменные окружения;
- настройте внешний планировщик (cron), который раз в нужный период делает
  `GET https://<ваш-домен>/api/cron/alert-rules` с заголовком
  `Authorization: Bearer <CRON_SECRET>`.

---

## Структура проекта

```
app/            страницы (App Router) и API-роуты (app/api/*)
components/     UI-компоненты по разделам
lib/            бизнес-логика: query engine, план/факт, AI, шифрование, Supabase-клиенты
stores/         Zustand-сторы (данные читаются/пишутся в Supabase через lib/supabase-db.ts)
supabase/       SQL: setup.sql (полная установка), schema*.sql и migrations/ (история)
docs/           описание раздела уведомлений
scripts/        тесты и генератор демо-CSV
public/demo/    синтетический демо-датасет
```

Подробнее о безопасности — в [`SECURITY.md`](SECURITY.md), об устройстве AI-анализа —
в [`AI_ANALYSIS_CONTEXT.md`](AI_ANALYSIS_CONTEXT.md).
