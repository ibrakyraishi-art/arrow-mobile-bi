# Контекст: вкладка «Уведомления» (`/notifications`)

> Справка по подсистеме Telegram-алертов в AI GoMobile (Next.js 14 App Router + TypeScript + Tailwind + shadcn/ui, БД — Supabase/Postgres, источник данных — ClickHouse + демо-режим).
> Актуально на 2026-05-30: без AI-генерации и дефолтных правил/шаблонов; создание правила — «конструктор анализа» (сводная таблица) с переменной `{table}` (PR #51).

---

## Назначение

«Уведомления» — это система **Telegram-алертов по метрикам датасетов**. Пользователь подключает Telegram-бота, создаёт шаблон сообщения и правило (датасет + условия + расписание). Когда условия правила срабатывают — в нужный чат уходит сообщение по шаблону.

- Пункт сайдбара: **«Уведомления»** (иконка `Bell`), маршрут `/notifications`.
- Корневая страница: `app/(app)/notifications/page.tsx` — компонент `Tabs` из 4 подвкладок. Активная вкладка синхронизируется с `window.location.hash` (`#connections` / `#templates` / `#rules` / `#runs`).

| Вкладка | id | Компонент |
|---|---|---|
| Подключения | `connections` | `ConnectionsTab.tsx` |
| Шаблоны сообщений | `templates` | `TemplatesTab.tsx` |
| Правила | `rules` | `RulesTab.tsx` (+ `RuleEditor.tsx`) |
| История | `runs` | `RunsTab.tsx` |

---

## 1. Подключения (`ConnectionsTab.tsx`)

Управление Telegram-ботами — **куда** слать алерты.

- Кнопка **«Добавить бота»** → диалог: `Название`, `Bot Token` (от @BotFather), `Chat ID`.
  - Раскрывающийся гайд «Как узнать Chat ID?» с тремя вариантами: личный чат / группа / канал (через `@userinfobot`).
  - Мягкие клиентские проверки ввода (предупреждают, если в Chat ID вставлен email, слишком короткое число, неверный формат группы; если токен слишком короткий) — не блокируют отправку.
- Сохранение → `POST /api/telegram/verify`: проверка бота через `getMe` + чата через `getChat`. **Токен хранится в БД зашифрованным (AES-256)** и не покидает сервер.
- Карточка подключения: бейдж `Верифицировано` / `Не проверено`, `@bot → чат`, `chat_id`, статус последнего теста. Кнопки:
  - **Тест** → `POST /api/telegram/{id}/test` (отправляет пробное сообщение);
  - **Удалить** → `DELETE /api/telegram/{id}`.
- Пустое состояние: «Нет подключений».

**Backend:** `/api/telegram` (GET список), `/api/telegram/[id]` (DELETE), `/api/telegram/[id]/test` (POST), `/api/telegram/verify` (POST). Таблица `telegram_connections`.

---

## 2. Шаблоны сообщений (`TemplatesTab.tsx`)

Текст сообщения, которое уйдёт в Telegram. Шаблон **не привязан** к конкретному датасету.

- **Переменные** вида `{name}` подставляются в момент срабатывания правила.
  - Фиксированные: `{user_email}`, `{dataset_name}`, `{period_label}`, `{now}`, `{rule_name}`, `{matches_count}`, **`{table}`** (сводная таблица по настройкам конструктора, моноширинный code-block), `{top_objects}`, `{tag_users}`, `{creative_name}`.
  - Динамические: колонки выбранного датасета + вычисляемые поля (ƒx) + плейсхолдеры расширенных условий (`{cpa_3d}`, `{deviation_percent}`, …).
- `TemplateEditorDialog`: поле названия, селектор датасета (только для подсказки переменных), палитра-чипы переменных с вставкой в позицию курсора, живое превью (`TemplatePreview`), режим форматирования `parse_mode`.
- Карточка шаблона: имя, превью тела, кнопки **Редактировать** / **Удалить**.
- Пустое состояние: «Нет шаблонов».

**Backend:** `GET`/`POST` `/api/notification-templates`, `PATCH`/`DELETE` `/api/notification-templates/[id]`. Таблица `notification_templates` (`id`, `user_id`, `name`, `body`, `parse_mode`, `created_at`).

> **Дефолтных/seed-шаблонов нет.** У нового пользователя список пустой — он создаёт шаблоны сам. (Ранее шаблоны `[AI] <rule_name>` авто-создавались AI-генератором правил; вместе с его удалением источник убран.)

---

## 3. Правила (`RulesTab.tsx` + `RuleEditor.tsx`)

Ядро вкладки. Правило (`AlertRule`) описывает **сводную таблицу (pivot)** по датасету и доставку её в Telegram. Создание — **одна форма** (конструктор анализа, не визард).

### Редактор (`RuleEditor.tsx`), секции:
1. **Основное** — название, описание.
2. **Источник** — датасет + период: «последние N дней» **или** «диапазон дат» (`analysis.dateRange`).
3. **Конструктор анализа** (главный блок):
   - **Строки (группировка)** — `MultiColumnPicker` для выбора + `OrderableChips` для порядка уровней (drag + стрелки ◀ ▶).
   - **Метрики** — `MetricsEditor`: колонка (числовая или ƒx) + агрегация (SUM/AVG/COUNT/MIN/MAX). Кнопка «Формула» → `QuickCalcDialog` (поле сразу доступно как метрика/фильтр/сортировка).
   - **Фильтры по значениям** — `ValueFiltersEditor` (`FilterCondition`: =, ≠, >, <, ≥, ≤, содержит, в списке) — отбор сущностей **до** агрегации (Источник = Meta; GEO в списке UAE, EG).
   - **Фильтры по метрикам (пороги)** — `ConditionsEditor`: `threshold` / `period_change` / `vs_group_avg` / `trend` + минимальный расход ($).
   - **Сортировка** — по колонке группировки или метрике, ↑/↓.
   - **Топ-N** — switch «только топ N» или все строки.
   - **Живое превью таблицы** — `LiveTablePreview`: дебаунс-запрос к `/api/alert-rules/preview` (dry-run), моноширинная таблица как она уйдёт в Telegram (не требует подключения/шаблона).
4. **Доставка** — Telegram-подключение, шаблон (+ «Новый» → `TemplateEditorDialog`), кого тегать.
5. **Превью сообщения** — `RulePreviewBlock` → `POST /api/alert-rules/preview` (dry-run: считает матчи и рендерит шаблон с `{table}`, **в Telegram не шлёт**).
6. **Расписание** — дни недели (чипы Пн–Вс) + пресеты «Будни»/«Выходные»/«Каждый день» + время. **Часовой пояс зафиксирован Europe/Moscow**, без выбора.
7. **Тестирование** — «Запустить сейчас» (доступно только для уже сохранённого правила).

Над формой — живая сводка `RuleSummary` («Что делает это правило»).

> **Дефолтных/seed-правил нет** — у нового пользователя список пуст (раньше правила авто-создавал удалённый AI-генератор). Создание — только ручное.

Настройки конструктора хранятся в `AlertRule.analysis` (`AlertAnalysisConfig`: `metrics`, `valueFilters`, `sort`, `topN`, `dateRange`) → колонка `alert_rules.analysis_config` (jsonb). Старые правила без неё работают по-старому.

### Карточка правила (`RulesTab.tsx`):
- Статус `Активно` / `На паузе`, расписание, `Last run` / `Next run`, список условий, привязанные бот/шаблон.
- Кнопки: **Запустить сейчас** (`POST /api/alert-rules/{id}/run`), **Редактировать**, **Дублировать** (создаёт ручную копию на паузе), **Пауза/Активировать** (`PATCH`), **Удалить**.
- Пустое состояние: «Нет правил».

**Backend:** `GET`/`POST` `/api/alert-rules`, `PATCH`/`DELETE` `/api/alert-rules/[id]`, `POST` `/api/alert-rules/[id]/run`, `POST` `/api/alert-rules/preview`, `GET /api/cron/alert-rules` (запуск по расписанию; защищён `CRON_SECRET`). Таблица `alert_rules`.

> **Создание правил — только ручное.** AI-генерация (`AIRuleGenerator` / `RefineRuleDialog`, роуты `/generate` и `/refine`, `lib/alert-ai.ts`) удалена. Запуск по cron в проде включается через `vercel.json` + переменные окружения.

---

## 4. История (`RunsTab.tsx`)

Лог срабатываний правил (`alert_runs`).

- Фильтры: правило, статус (`ok` / `error` / `no_match`), диапазон дат.
- Строка разворачивается: отправленное сообщение, текст ошибки, найденные объекты (JSON), кнопка **Повторить** (`POST /api/alert-rules/{id}/run`).
- Поле AI-рекомендации показывается только для **исторических** запусков, где оно было сохранено; для новых запусков всегда пусто (AI-рекомендации отключены).
- Пустое состояние: «Нет срабатываний».

**Backend:** `GET /api/alert-runs` (rule_name берётся через JOIN, `used_ai = ai_recommendation IS NOT NULL`). Таблица `alert_runs`.

---

## Движок выполнения (`lib/alert-engine.ts`)

`executeRule(supabase, input)` — что происходит при запуске правила (вручную / по cron / dry-run превью):
1. Валидация имён колонок/таблиц (защита от SQL-инъекций через `groupBy` / `metric`).
2. Построение pivot-выборки (группировка + display-метрики конструктора + value-фильтры + период/диапазон дат):
   - **ClickHouse**: `SELECT … WHERE <value-фильтры/период> GROUP BY … HAVING <пороги>` (пороговые условия → `HAVING`; расширенные `period_change`/`vs_group_avg`/`trend` → builder `buildAdvancedSql`; value-фильтры → `valueFiltersToSqlWhere`);
   - **демо**: in-memory (`applyFilters` + `aggregate` / `evaluateAdvancedDemo`).
3. Фильтрация по условиям, затем **сортировка + топ-N** (`applySortAndLimit`); `matchedCount` остаётся полным.
4. Рендер сводной таблицы (`renderPivotTableText`, топ-100 строк, формат чисел из `format-value`) → переменная `{table}` (`wrapTableForParseMode`: code-block для Markdown/HTML, plain для none).
5. Подстановка переменных (`buildVariables`) и рендер тела (`renderTemplate`) с экранированием под `parse_mode`.
6. Отправка в Telegram (`sendTelegramMessage`): короткие — одним сообщением; длинные — чанками; очень длинные — превью + файл `alert-detail.txt`. Авто-фоллбэк на «без разметки» при ошибке парсинга entities.
7. Результат (`status`, `matchedCount`, `matchedObjects`, `message`, `table`, `durationMs`, `errorText`) → сохраняется в `alert_runs`, обновляются `last_run_*` / `next_run_at` правила.

`loadExecuteRuleInput(..., { allowMissingDelivery })` — для dry-run превью таблицы подключение/шаблон необязательны (в Telegram ничего не уходит); реальный запуск требует оба.

`calcNextRunAt(schedule)` — расчёт следующего запуска с учётом таймзоны.

> Движок **больше не ходит в Anthropic**: функция `fetchAiRecommendation` и проброс `apiKey` удалены. Переменная `{ai_recommendation}` зарезервирована и рендерится как `—` (для совместимости со старыми шаблонами).

**Подготовка входа:** `lib/alert-execution-setup.ts` — `loadExecuteRuleInput` (грузит датасет/подключение/шаблон) и `persistAlertExecutionResult` (пишет `alert_runs` + апдейт `alert_rules`).

---

## Модель данных (`lib/types.ts`)

- `TelegramConnection` — бот + целевой чат + статусы проверки/теста.
- `NotificationTemplate` — `name`, `body`, `parseMode` (`none` / `markdown` / `markdownv2` / `html`).
- `AlertCondition` — discriminated union по `kind` (`threshold` / `period_change` / `vs_group_avg` / `trend`), объединяются через **AND**.
- `ScheduleConfig` — `type`, `time`, `daysOfWeek` (0=Вс…6=Сб), `intervalHours`, `timezone`.
- `AlertAnalysisConfig` — конфиг конструктора анализа: `metrics` (`PivotValueConfig[]`), `valueFilters` (`FilterCondition[]`), `sort` (`AlertSortConfig`), `topN`, `dateRange`. Нормализуется `normalizeAnalysisConfig`.
- `AlertRule` — полная конфигурация правила (см. раздел 3), включая `analysis`.
- `AlertRun` — запись об одном срабатывании.

**Таблицы Supabase** (RLS по `user_id = auth.uid()`): `telegram_connections`, `notification_templates`, `alert_rules`, `alert_runs`. Миграции: `001_telegram_alerts.sql` (+ `002` гранты, `003` calc-поля, `004` `ai_meta`, `005` `analysis_config`).

---

## Карта файлов

```
app/(app)/notifications/page.tsx          # страница с Tabs
app/api/
  telegram/                               # боты: route, [id], [id]/test, verify
  notification-templates/                 # шаблоны: route, [id]
  alert-rules/                            # правила: route, [id], [id]/run, preview
  cron/alert-rules/route.ts               # запуск по расписанию
  alert-runs/route.ts                     # история
components/notifications/
  ConnectionsTab.tsx                      # вкладка «Подключения»
  TemplatesTab.tsx                        # вкладка «Шаблоны» (+ TemplateEditorDialog)
  template-helpers.tsx                    # переменные шаблона + превью
  RulesTab.tsx                            # вкладка «Правила» (список + карточки)
  RuleEditor.tsx                          # редактор правила (конструктор анализа, одна форма)
  ConditionsEditor.tsx                    # фильтры по метрикам (пороги/тренды)
  MultiColumnPicker.tsx                   # мультивыбор колонок (строки группировки)
  OrderableChips.tsx                      # порядок уровней группировки (drag + стрелки)
  MetricsEditor.tsx                       # метрики таблицы (колонка + агрегация)
  ValueFiltersEditor.tsx                  # фильтры по значениям полей
  LiveTablePreview.tsx                    # живое превью сводной таблицы (dry-run)
  QuickCalcDialog.tsx                     # быстрый калькулятор вычисляемого поля
  RulePreviewBlock.tsx                    # превью сообщения (dry-run)
  RuleSummary.tsx                         # сводка «Что делает правило»
  RunsTab.tsx                             # вкладка «История»
lib/
  alert-engine.ts                         # движок: SQL/демо, рендер, отправка в Telegram
  alert-execution-setup.ts               # загрузка входа + запись результата
  alert-conditions.ts                     # SQL/JS для расширенных условий
  alert-rules-helpers.ts                  # маппинг строк БД ↔ AlertRule
  types.ts                                # типы домена уведомлений
```

---

## Что НЕ относится к этой вкладке

- `lib/ai-templates.ts` и `app/api/ai/analyze` — это отдельная фича **«AI-анализ»** (быстрые действия Claude над датасетом), к уведомлениям отношения не имеет.
