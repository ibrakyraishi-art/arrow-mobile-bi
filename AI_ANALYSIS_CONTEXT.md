# Контекст вкладки «AI-анализ» (ai-gomobile)

> Документ-контекст для передачи другому AI-чату. Описывает, как устроена
> вкладка **AI-анализ** в проекте `ai-gomobile`: пользовательский поток, поток
> данных, интеграция с Claude API, модель данных, безопасность и карта файлов.
> Составлено по фактическому коду (не по догадкам). Идентификаторы/пути — как в репозитории.

---

## 1. Что это за раздел

**AI-анализ** — раздел BI-платформы, где пользователь анализирует свои данные
(из ClickHouse) с помощью Claude. Работа организована вокруг **проектов**:

- **Проект** (`ai_projects`) привязан к одному **датасету**, хранит выбранную
  модель, настроенные фильтры, сохранённый промпт / конфиг конструктора.
- Внутри проекта пользователь сколько угодно раз запускает анализ; каждый
  запуск сохраняется в **историю** (`ai_project_runs`) с промптом, ответом,
  токенами и стоимостью.

Стек: **Next.js 14 (App Router)** + **Supabase (Postgres + Auth + RLS)** +
**ClickHouse** (внешняя БД пользователя) + **Anthropic Claude API** (стриминг).

---

## 2. Пользовательский поток (UI)

### `/ai-analysis` — список проектов
`app/(app)/ai-analysis/page.tsx`
- Сетка карточек проектов (`AiProjectCard`), кнопка **«Создать проект»**
  (`CreateAiProjectDialog` — выбор датасета + имя).
- Состояние из `useAiProjectStore` (Zustand). Операции: удалить, дублировать.

### `/ai-analysis/[id]` — страница проекта
`app/(app)/ai-analysis/[id]/page.tsx` (главный экран, ~890 строк)
Сверху вниз:
1. **Шапка**: редактируемое имя, бейдж датасета, `ModelSelector`
   (haiku/sonnet/opus), оценка стоимости запроса.
2. **Фильтры** (`ProjectFilters`): настраиваемый набор фильтров
   (`filtersConfig`) + их значения (`filterValues`). Сохраняются в проекте.
3. **`ApiKeySetup`** (показывается, если ключ Claude не задан).
4. **Две вкладки выбора промпта**:
   - **«Свой промпт»** — свободный `Textarea`.
   - **«Конструктор»** (`PromptBuilder`) — визуальный сборщик: выбор столбцов,
     группировка, период, «фокус анализа», доп. контекст → функция
     `buildPromptFromConfig()` генерирует текст промпта.
   - Кнопки **«Сохранить промпт / Сохранить конфиг»** и **«Анализировать»**.
5. **Результат**: стримящийся markdown (`AnalysisResult`), мета (модель, токены,
   стоимость), `ExportPanel` (экспорт ответа).
6. **История запусков**: список `ai_project_runs` — разворачивается, удаляется,
   можно выбрать 2 запуска и сравнить side-by-side.

---

## 3. Поток данных при анализе (ключевое!)

Функция `handleAnalyze()` в `app/(app)/ai-analysis/[id]/page.tsx`:

1. Собирает условия фильтров: `buildGlobalFilterConditions(filtersConfig, filterValues)`.
2. **`POST /api/query`** — тянет данные из ClickHouse по подключению датасета
   (`host/port/database/user/password/ssl`, `table`/`sqlQuery`, `chartType:"pivot"`,
   переданные фильтры, `calculatedFields`, **`limit: 500`**). Возвращает строки.
3. Строки → **CSV** (`rowsToCsv`, экранирование кавычек/запятых).
4. **`POST /api/ai/analyze`** (SSE-стриминг) с телом:
   `prompt`, `dataType:"dataset"`, `dataId`, `columns`, `csv`, `model`,
   `businessContext`, `columnDescriptions` (из `businessContext`/`aiDescription`
   столбцов и вычисляемых полей), `funnelSteps`, `additionalContext` (из
   конструктора), `filters`, `filteredRowCount`.
5. Сервер стримит ответ; клиент накапливает текст в `resultMd`. По событию
   `done` вызывает `createRun(...)` → запись в `ai_project_runs`.

> Важно: **в Claude уходит только CSV-срез (макс. 500 строк) + метаданные о
> столбцах/контексте**, а не вся база. Сырые креды ClickHouse в Claude не передаются.

---

## 4. Серверный роут `/api/ai/analyze` (ядро интеграции)

`app/api/ai/analyze/route.ts` (`runtime = "nodejs"`, `dynamic = "force-dynamic"`).

Шаги:
1. **Авторизация**: `getAuthenticatedUser()` → 401, если нет.
2. **Rate limit**: ключ `ai:${user.id}`, лимиты `RATE_LIMITS.AI_ANALYZE`
   (`lib/rate-limit.ts`) → 429 при превышении.
3. **API-ключ**: читает `user_settings.anthropic_api_key` под текущим
   пользователем → `decrypt()` (`lib/encryption.ts`, AES-256-CBC) →
   `prepareAnthropicKey()` (`lib/anthropic-key.ts`) валидирует. Если нет —
   ошибка «настройте ключ».
4. **Модель**: из `body.model` (haiku/sonnet/opus), иначе `DEFAULT_MODEL` (sonnet).
5. **System-промпт**: `buildSystemPrompt(body)` (см. §6).
6. **User-сообщение**: `Данные (CSV, до 500 строк):\n\`\`\`csv\n<csv>\n\`\`\`\n\nЗапрос: <prompt>`.
7. **Вызов Anthropic**: `POST https://api.anthropic.com/v1/messages`
   - заголовки: `x-api-key`, `anthropic-version: 2023-06-01`;
   - тело: `model: modelInfo.apiId`, **`max_tokens: 4096`**, `stream: true`,
     `system`, `messages:[{role:"user", content}]`;
   - `signal: request.signal` (отмена при abort клиента).
8. **Проксирование SSE**: парсит чанки Anthropic и переотдаёт упрощённые события:
   - `{ type: "text", content }` — кусок текста;
   - `{ type: "done", cost, model, usage:{input,output} }` — финал + расчёт цены;
   - `{ type: "error", error }`.
   Токены берутся из `message_start`/`message_delta`. Стоимость считается по
   ценам модели.
9. **Аудит**: `logAudit(..., "ai_analysis_run", ...)` (fire-and-forget).

Ошибки до стрима возвращаются как SSE-событие `error` (функция `sseErrorResponse`).

---

## 5. Модели и стоимость

`lib/ai-models.ts` — `AI_MODELS` (значения `apiId`/цены **как в коде**):

| id     | apiId (в коде)               | $/1M input | $/1M output | бейдж         |
|--------|------------------------------|-----------:|------------:|---------------|
| haiku  | `claude-haiku-4-5-20251001`  | 0.25       | 1.25        | Экономный     |
| sonnet | `claude-sonnet-4-6`          | 3          | 15          | Рекомендуется |
| opus   | `claude-opus-4-7`            | 15         | 75          | Премиум       |

- `DEFAULT_MODEL = "sonnet"`.
- `estimateModelCost(model, inputTokens, outputTokens)` — расчёт цены.
- Клиентская оценка токенов: `estimateTokens()` (`components/ai/CostEstimate.tsx`);
  на странице проекта оценка = `estimateModelCost(model, promptTokens + 2000, 2000)`.
- Отдельный роут **`/api/ai/estimate-cost`**: грубая оценка
  (`inputTokens = ceil(len/3.5)`, output по умолчанию 2000, цены sonnet 3/15).

> Примечание: `apiId` моделей зашиты в `lib/ai-models.ts`. Если другой чат будет
> обновлять модели — менять надо там (и сверять с актуальными ID Anthropic).

---

## 6. Как собирается System-промпт

`buildSystemPrompt(body)` в `app/api/ai/analyze/route.ts` склеивает блоки через `\n\n`:
1. **Роль**: `body.systemTemplate` (если передан) **или** дефолт — «Ты — опытный
   аналитик данных…».
2. **Контекст бизнеса**: `body.businessContext` (из `dataset.businessContext`).
3. **Столбцы**: список `- name (datasetType/clickhouseType): <описание>`, где
   описание берётся из `aiDescription` → `businessContext` → `description`.
4. **Воронка**: `funnelSteps` → «1) label (column) → 2) …».
5. **Применённые фильтры** + размер среза (`filteredRowCount`).
6. **Доп. контекст пользователя**: `additionalContext`.
7. **Инструкции по формату**: ответ на русском, markdown (заголовки/списки/
   таблицы), конкретные цифры, выделять аномалии/тренды, **не выдумывать данные**.

---

## 7. Режимы промпта

### «Свой промпт»
Свободный текст в `Textarea`, сохраняется в `ai_projects.prompt`.

### «Конструктор» (`components/ai/PromptBuilder.tsx`)
Конфиг `AIBuilderConfig`:
- `columns: string[]` — какие показатели анализировать (пусто = все);
- `groupBy?: string` — группировка (по категор./строк./датам);
- `period?: { from?, to? }` — период;
- `focus: AIBuilderFocus[]` — из набора: `problems`, `trends`, `segments`,
  `optimization`, `report`;
- `additionalContext?: string`.

`buildPromptFromConfig(config, datasetName)` превращает конфиг в человекочитаемый
промпт. Конфиг сохраняется в `ai_projects.builder_config`.

### Быстрые действия (шаблоны) — **есть в коде, но не подключены к странице проекта**
`lib/ai-templates.ts` (`QUICK_ACTIONS`: diagnostics/funnel/budget/trends/
comparison/report — каждый со своим `systemPrompt`) и компонент
`components/ai/QuickActions.tsx`. Роут `/api/ai/analyze` поддерживает их через
поле `systemTemplate`, но текущий `[id]/page.tsx` использует вкладки «Свой
промпт»/«Конструктор», а `QuickActions` в нём не импортируется (компонент-
заготовка / возможно для будущего или другого экрана).

---

## 8. API-ключ Claude

- Задаётся пользователем (`components/ai/ApiKeySetup.tsx`) →
  **`POST /api/settings/api-key`** → `encrypt()` (AES-256-CBC,
  ключ `ENCRYPTION_KEY` только на сервере) → хранится в
  **`user_settings.anthropic_api_key`** (зашифрованным).
- При анализе роут читает и расшифровывает его **только на сервере**; в браузер
  сырой ключ Claude не отдаётся.
- В таблице есть legacy-колонка `claude_api_key_encrypted` — **текущий код её не
  использует**, актуальная колонка `anthropic_api_key`.

---

## 9. Модель данных (Supabase, схема `public`)

**`ai_projects`** — проект:
`id (uuid)`, `user_id (uuid)`, `dataset_id (text)`, `name`, `description?`,
`prompt?`, `filters? (jsonb, legacy)`, `model?`, `created_at`, `updated_at`,
`builder_config? (jsonb)`, `filter_values? (jsonb)`, `filters_config? (jsonb)`.

**`ai_project_runs`** — запуск (история внутри проекта):
`id`, `project_id`, `user_id`, `prompt`, `filters_snapshot (jsonb)`, `response?`,
`model?`, `input_tokens?`, `output_tokens?`, `cost?`, `created_at`.

**`ai_analyses`** — разовые анализы (не привязаны к проекту; более старый поток):
`id`, `user_id`, `data_type`, `data_id`, `data_name?`, `prompt`, `response?`,
`cost?`, `created_at`, `model?`.

**`user_settings`** — настройки пользователя:
`user_id`, `anthropic_api_key? (зашифр.)`, `claude_api_key_encrypted? (legacy)`,
`theme?`, `created_at`, `updated_at`.

> На всех таблицах включён **RLS** с политиками `auth.uid() = user_id` (каждый
> видит только свои строки); на `user_id` есть индексы.

---

## 10. Безопасность (важно для другого чата)

- **Все AI-роуты требуют авторизации** (`getAuthenticatedUser` → 401).
- **Rate limiting** на `/api/ai/analyze` (per-user).
- **RLS** на `ai_projects` / `ai_project_runs` / `ai_analyses` / `user_settings`.
- **API-ключ Claude и пароли ClickHouse** хранятся **зашифрованными** (AES-256-CBC,
  `lib/encryption.ts`); ключ шифрования `ENCRYPTION_KEY` — только на сервере.
- В клиентский бандл серверные секреты не попадают.
- Ответы об ошибках не раскрывают внутренности БД (детали — в серверный лог).

---

## 11. Карта файлов

**Страницы**
- `app/(app)/ai-analysis/page.tsx` — список проектов.
- `app/(app)/ai-analysis/[id]/page.tsx` — страница проекта (главная логика анализа).

**API-роуты**
- `app/api/ai/analyze/route.ts` — стриминговый анализ через Claude (ядро).
- `app/api/ai/estimate-cost/route.ts` — оценка стоимости.
- `app/api/query/route.ts` — выборка данных из ClickHouse (используется анализом).
- `app/api/settings/api-key/route.ts` — сохранение зашифрованного ключа Claude.

**Библиотеки**
- `lib/ai-models.ts` — модели, цены, `estimateModelCost`.
- `lib/ai-templates.ts` — шаблоны быстрых действий (`QUICK_ACTIONS`).
- `lib/anthropic-key.ts` — валидация/подготовка ключа.
- `lib/encryption.ts` — AES-256-CBC encrypt/decrypt.
- `lib/rate-limit.ts` — лимиты (`RATE_LIMITS.AI_ANALYZE`).
- `lib/audit.ts` — `logAudit`.
- `lib/types.ts` — типы (`AIModelId`, `AIProject`, `AIProjectRun`, `AIBuilderConfig`,
  `AIBuilderFocus`, `Dataset`, `FilterCondition`, …).

**Компоненты (`components/ai/`)**
- `AiProjectCard`, `CreateAiProjectDialog` — список/создание проектов.
- `ModelSelector` — выбор модели.
- `ProjectFilters` — фильтры проекта.
- `PromptBuilder` (+ `buildPromptFromConfig`) — конструктор промпта.
- `AnalysisResult` — рендер стримящегося markdown.
- `AnalysisHistory` — история (есть также инлайн-история в `[id]/page.tsx`).
- `ExportPanel` — экспорт результата.
- `CostEstimate` (+ `estimateTokens`) — оценка токенов/стоимости.
- `ApiKeySetup` — ввод ключа Claude.
- `QuickActions` — кнопки быстрых действий (в текущей странице проекта не подключён).

**Stores (Zustand)**
- `stores/aiProjectStore.ts` — проекты, запуски, `loadProject/createRun/...`.
- `stores/datasetStore.ts`, `stores/dataSourceStore.ts`, `stores/settingsStore.ts`.

---

## 12. Ограничения и нюансы (на что обратить внимание)

- **Лимит данных**: в анализ уходит максимум **500 строк** CSV (`limit: 500`).
- **`max_tokens: 4096`** на ответ Claude (длинные отчёты могут обрезаться).
- **Язык ответа**: всегда русский, markdown (заложено в system-промпт).
- **`apiId` моделей зашиты** в `lib/ai-models.ts` — сверять с актуальными ID.
- **Две колонки ключа** в `user_settings`: рабочая — `anthropic_api_key`,
  `claude_api_key_encrypted` — legacy.
- **`ai_projects.filters` (jsonb)** — похоже legacy; актуальны
  `filters_config` + `filter_values`.
- **`ai_analyses`** — отдельный, более старый поток разовых анализов (не
  проектный); проектный поток пишет в `ai_project_runs`.
- Стриминг — собственный SSE-протокол (`text`/`done`/`error`), а не сырой формат
  Anthropic: при доработке клиента/сервера сохранять контракт событий.
