/**
 * Проверки демо-витрины (lib/demo-data.ts): детерминизм генератора,
 * калибровка под демо-план (через функции lib/plan), CSV через существующий
 * парсер (lib/file-parse.ts), ссылки демо-объектов.
 *
 * Запуск: `node scripts/test-demo.cjs`. Тестируется РЕАЛЬНЫЙ код: .ts
 * транспилируется на лету (scripts/demo-ts-loader.cjs), без копий.
 *
 * Ожидаемые значения — из спецификации и interfaces.md («Демо»): имена колонок,
 * цели калибровки (расход ≈ 88%, установки ≈ 100%, CPI зелёный, покупки 85–90%).
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./demo-ts-loader.cjs");

const demo = require(path.join(ROOT, "lib/demo-data.ts"));

let pass = 0;
let fail = 0;
const queue = [];
function test(name, fn) {
  queue.push({ name, fn });
}

/** 20 октября 2026, полдень по Москве. */
const NOW = new Date("2026-10-20T09:00:00Z");

// Колонки installs_daily — дословно из interfaces.md «Демо».
const SPEC_COLUMNS = [
  "date", "client", "channel", "geo", "buyer", "campaign",
  "impressions", "clicks", "installs", "registrations", "purchases",
  "spend_rub", "spend_usd", "revenue_rub", "revenue_usd",
];

test("генератор детерминирован и выдаёт колонки из спецификации", () => {
  const a = demo.generateDemoRows(NOW);
  const b = demo.generateDemoRows(NOW);
  assert.ok(a.length > 0, "строк нет");
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a[0]), SPEC_COLUMNS);
  // Период: 1 июля (3 полных месяца назад) … 20 октября включительно.
  const dates = a.map((r) => r.date).sort();
  assert.equal(dates[0], "2026-07-01");
  assert.equal(dates[dates.length - 1], "2026-10-20");
});

test("объём укладывается в лимит файлового загрузчика даже в самый длинный период", () => {
  const { FILE_MAX_ROWS } = require(path.join(ROOT, "lib/file-constants.ts"));
  // 31 августа: май (31) + июнь (30) + июль (31) + август (31) = 123 дня — максимум.
  const rows = demo.generateDemoRows(new Date("2026-08-31T12:00:00Z"));
  assert.equal(new Set(rows.map((r) => r.date)).size, 123);
  assert.ok(rows.length <= FILE_MAX_ROWS, `${rows.length} > ${FILE_MAX_ROWS}`);
});

const plan = require(path.join(ROOT, "lib/plan/index.ts"));

/** Итог по строкам месяца как одна группа для fillPlanColumns (факт считаем суммами вручную). */
function monthGroup(rows, month) {
  const m = rows.filter((r) => r.date.startsWith(month));
  const sum = (k) => m.reduce((s, r) => s + r[k], 0);
  const spend = sum("spend_rub");
  const installs = sum("installs");
  return {
    row: { month },
    facts: {
      spend_rub: spend,
      installs,
      purchases: sum("purchases"),
      "CPI ₽": spend / installs,
      "ROAS %": (sum("revenue_rub") / spend) * 100,
    },
    dates: m.map((r) => r.date),
  };
}

function calibrationReport(now) {
  const rows = demo.generateDemoRows(now);
  const project = plan.buildDemoPlanProject(now);
  const month = plan.moscowMonth(now);
  const [out] = plan.fillPlanColumns([monthGroup(rows, month)], project, now);
  const pct = (label) => out[`${label} · выполнение %`];
  const light = (label) => {
    const f = project.fields.find((x) => x.label === label);
    return plan.completionColumnLight(pct(label), f.direction);
  };
  return { rows, project, out, pct, light };
}

for (const iso of ["2026-10-20T09:00:00Z", "2026-11-01T09:00:00Z", "2026-12-31T18:00:00Z"]) {
  test(`калибровка текущего месяца (${iso.slice(0, 10)}): расход ≈ 88%, установки ≈ 100%, CPI зелёный, покупки 85–90%`, () => {
    const { pct, light } = calibrationReport(new Date(iso));
    assert.ok(Math.abs(pct("Расход") - 88) <= 1, `расход ${pct("Расход")}%`);
    assert.equal(light("Расход"), "warn");
    assert.ok(Math.abs(pct("Установки") - 100) <= 1, `установки ${pct("Установки")}%`);
    assert.equal(light("Установки"), "ok");
    assert.equal(light("CPI"), "ok", `CPI ${pct("CPI")}%`);
    assert.ok(pct("Покупки") >= 85 && pct("Покупки") <= 90, `покупки ${pct("Покупки")}%`);
    assert.equal(light("Покупки"), "warn");
    assert.equal(light("ROAS"), "ok", `ROAS ${pct("ROAS")}%`);
  });
}

test("прошлые месяцы — около плана (95–102% по объёмам)", () => {
  const now = NOW;
  const rows = demo.generateDemoRows(now);
  const project = plan.buildDemoPlanProject(now);
  for (const offset of [-3, -2, -1]) {
    const month = plan.addMonths(plan.moscowMonth(now), offset);
    const [out] = plan.fillPlanColumns([monthGroup(rows, month)], project, now);
    for (const label of ["Расход", "Установки", "Покупки"]) {
      const v = out[`${label} · выполнение %`];
      assert.ok(v >= 94.5 && v <= 102.5, `${month} ${label}: ${v}%`);
    }
  }
});

test("public/demo/arrow-mobile-demo.csv проходит существующий парсер и совпадает с генератором", async () => {
  const { parseCsvBuffer } = require(path.join(ROOT, "lib/file-parse.ts"));
  const buf = fs.readFileSync(path.join(ROOT, "public/demo/arrow-mobile-demo.csv"));
  const parsed = await parseCsvBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(parsed.truncated, false);
  assert.deepEqual(parsed.columns.map((c) => c.name), SPEC_COLUMNS);
  const type = Object.fromEntries(parsed.columns.map((c) => [c.name, c.type]));
  assert.equal(type.date, "date");
  for (const c of ["impressions", "clicks", "installs", "registrations", "purchases"]) {
    assert.equal(type[c], "integer", c);
  }
  for (const c of ["spend_rub", "spend_usd", "revenue_rub", "revenue_usd"]) {
    assert.equal(type[c], "float", c);
  }
  for (const c of ["client", "channel", "geo", "buyer", "campaign"]) {
    assert.ok(type[c] === "category" || type[c] === "string", `${c}: ${type[c]}`);
  }
  // Файл сгенерирован на день последней строки — тот же генератор даёт те же строки.
  const last = parsed.rows.map((r) => r.date).sort().pop();
  const expected = demo.generateDemoRows(new Date(`${last}T09:00:00Z`));
  assert.deepEqual(parsed.rows, expected);
});

test("демо-витрина: датасет, ≥ 10 визуализаций всех 7 типов, 2 дашборда, все ссылки живые", () => {
  const { validateFormula } = require(path.join(ROOT, "lib/formula.ts"));
  const dataset = demo.buildDemoDataset(NOW);
  const vizs = demo.buildDemoVisualizations(NOW);
  const dashboards = demo.buildDemoDashboards(NOW);
  const project = plan.buildDemoPlanProject(NOW);

  assert.equal(dataset.id, "demo-dataset-installs");
  assert.equal(dataset.table, "installs_daily");
  assert.deepEqual(dataset.columns.map((c) => c.name), SPEC_COLUMNS);
  for (const c of dataset.columns) assert.ok(c.description, `нет описания у ${c.name}`);

  // Вычисляемые поля из interfaces.md с форматами.
  const calc = Object.fromEntries(dataset.calculatedFields.map((f) => [f.name, f]));
  assert.equal(calc["CPI ₽"].formula, "SUM([spend_rub]) / SUM([installs])");
  assert.equal(calc["CPA ₽"].formula, "SUM([spend_rub]) / SUM([purchases])");
  assert.equal(calc["CTR %"].formula, "SUM([clicks]) / SUM([impressions]) * 100");
  assert.equal(calc["ROAS %"].formula, "SUM([revenue_rub]) / SUM([spend_rub]) * 100");
  assert.ok(calc["CR в установку %"], "нет CR в установку %");
  assert.equal(calc["CPI ₽"].format, "currency_rub");
  assert.equal(calc["ROAS %"].format, "percent");
  const columnNames = dataset.columns.map((c) => c.name);
  for (const f of dataset.calculatedFields) {
    const v = validateFormula(f.formula, columnNames);
    assert.ok(v.ok !== false && !v.error, `${f.name}: ${JSON.stringify(v)}`);
  }

  // Каждая колонка в конфиге — колонка датасета, вычисляемое поле или поле плана.
  const known = new Set([
    ...columnNames,
    ...dataset.calculatedFields.map((f) => f.name),
    ...plan.planVirtualFields(project).map((f) => f.name),
  ]);
  const planCols = new Set(plan.planVirtualFields(project).map((f) => f.name));
  const used = (cfg) => [
    ...(cfg.rows || []), ...(cfg.columns || []),
    ...(cfg.values || []).map((v) => v.column),
    ...(cfg.yAxis ? [cfg.yAxis.column] : []),
    ...(cfg.xAxis ? [cfg.xAxis] : []), ...(cfg.series ? [cfg.series] : []),
  ];
  const ids = new Set();
  for (const v of vizs) {
    assert.ok(v.id.startsWith("demo-"), v.id);
    assert.ok(!ids.has(v.id), `дубль id ${v.id}`);
    ids.add(v.id);
    assert.equal(v.datasetId, dataset.id);
    for (const c of used(v.config)) assert.ok(known.has(c), `${v.name}: нет поля «${c}»`);
  }
  // Витрина «сама по себе» (без шаблона план/факт): ≥ 10, все 7 типов.
  const showcase = vizs.filter((v) => !v.id.startsWith("demo-plan-"));
  assert.ok(showcase.length >= 10, `визуализаций ${showcase.length}`);
  for (const t of ["pivot", "bar", "line", "area", "pie", "combo", "progress"]) {
    assert.ok(showcase.some((v) => v.type === t), `нет типа ${t}`);
  }
  const onCalc = showcase.filter((v) => used(v.config).some((c) => ["CPI ₽", "ROAS %", "CTR %"].includes(c)));
  assert.ok(onCalc.length >= 3, `на вычисляемых полях: ${onCalc.length}`);
  const onPlan = showcase.filter((v) => used(v.config).some((c) => planCols.has(c)));
  assert.ok(onPlan.length >= 2, `на полях плана: ${onPlan.length}`);
  // Разрезы: клиент, канал, гео, баер, день.
  for (const dim of ["client", "channel", "geo", "buyer", "date"]) {
    assert.ok(showcase.some((v) => used(v.config).includes(dim)), `нет разреза ${dim}`);
  }

  assert.equal(dashboards.length, 2);
  const overview = dashboards.find((d) => d.name === "Обзор Arrow Mobile");
  const planDash = dashboards.find((d) => d.name === "План/факт");
  assert.ok(overview && planDash, dashboards.map((d) => d.name).join(", "));
  assert.deepEqual(overview.sheets.map((s) => s.name), ["Обзор", "Каналы", "Клиенты", "Гео и баеры"]);
  assert.deepEqual(
    overview.filtersConfig.map((f) => f.column).sort(),
    ["buyer", "channel", "client", "date", "geo"],
  );
  const overviewMetrics = overview.sheets[0].widgets.filter((w) => w.widgetType === "metric").map((w) => w.config.column);
  for (const c of ["spend_rub", "installs", "CPI ₽", "ROAS %"]) assert.ok(overviewMetrics.includes(c), `нет карточки ${c}`);
  assert.ok(planDash.sheets.some((s) => s.name === "План/факт"));
  // §10 после ревью (D03): разрезы client и channel — из шаблона, без «· выполнение %»; ручного листа «Каналы» нет.
  assert.deepEqual(planDash.sheets.map((s) => s.name), ["План/факт", "Разрезы"]);
  const vizById = Object.fromEntries(vizs.map((v) => [v.id, v]));
  const cutVizs = planDash.sheets[1].widgets.map((w) => vizById[w.visualizationId]);
  const cutDims = new Set(cutVizs.map((v) => v.config.rows[0] ?? v.config.xAxis));
  assert.deepEqual([...cutDims], ["client", "channel"]);
  assert.ok(!cutVizs.some((v) => used(v.config).some((c) => c.includes("· выполнение %"))), "в «Разрезах» нет выполнения");
  assert.ok(cutVizs.some((v) => v.name.includes("Клиент")) && cutVizs.some((v) => v.name.includes("Канал")), "подписи разрезов человеческие");
  assert.ok(!cutVizs.some((v) => /\b(client|channel)\b/.test(v.name)), "в подписях нет сырых имён колонок");

  // Денежные карточки — в ₽ (currency_rub или auto от формата поля), не «number».
  const money = new Set(["spend_rub", "revenue_rub", "spend_usd", "revenue_usd", "CPI ₽", "CPA ₽", "CPI $"]);
  for (const d of dashboards) {
    for (const w of d.sheets.flatMap((s) => s.widgets)) {
      if (w.widgetType === "metric" && money.has(w.config.column)) {
        assert.ok(["currency_rub", "currency_usd", "auto"].includes(w.config.format), `${w.title}: формат ${w.config.format}`);
      }
    }
  }
  const spendCard = overview.sheets[0].widgets.find((w) => w.config.column === "spend_rub");
  assert.equal(spendCard.config.format, "currency_rub");
  assert.equal(overview.sheets[0].widgets.find((w) => w.config.column === "CPI ₽").config.format, "auto");

  const sheetIds = new Set();
  const widgetIds = new Set();
  for (const d of dashboards) {
    assert.ok(d.id.startsWith("demo-"), d.id);
    assert.equal(d.datasetId, dataset.id);
    for (const f of d.filtersConfig) assert.ok(known.has(f.column), `${d.name}: фильтр по «${f.column}»`);
    for (const s of d.sheets) {
      assert.ok(s.id.startsWith("demo-") && !sheetIds.has(s.id), s.id);
      sheetIds.add(s.id);
      assert.equal(s.dashboardId, d.id);
      for (const w of s.widgets) {
        assert.ok(w.id.startsWith("demo-") && !widgetIds.has(w.id), w.id);
        widgetIds.add(w.id);
        assert.equal(w.sheetId, s.id);
        if (w.visualizationId) assert.ok(ids.has(w.visualizationId), `${d.name}: нет визуализации ${w.visualizationId}`);
        if (w.widgetType === "metric") assert.ok(known.has(w.config.column), `${d.name}: метрика «${w.config.column}»`);
      }
    }
  }
});

test("старые экспорты DEMO_TABLES / DEMO_ROW_COUNTS считают строки по вызову (на сегодня)", () => {
  const today = demo.generateDemoRows(new Date()).length;
  assert.equal(demo.DEMO_TABLES[0].name, "installs_daily");
  assert.equal(JSON.parse(JSON.stringify(demo.DEMO_TABLES))[0].totalRows, today);
  assert.equal(demo.DEMO_ROW_COUNTS.installs_daily, today);
  assert.equal(demo.buildDemoDataset(NOW).rowCount, demo.generateDemoRows(NOW).length);
});

test("демо-строки кешируются по дню (Москва): второй вызов на порядок быстрее и без повторной генерации", () => {
  // День, который ещё не запрашивался в этом прогоне, — первый вызов генерирует заново.
  const day = new Date("2026-05-15T09:00:00Z");
  const sameDayLater = new Date("2026-05-15T20:00:00Z"); // 23:00 по Москве — тот же день
  let t = process.hrtime.bigint();
  const first = demo.getDemoDataAt(day);
  const firstNs = Number(process.hrtime.bigint() - t);
  t = process.hrtime.bigint();
  const second = demo.getDemoDataAt(sameDayLater);
  const secondNs = Number(process.hrtime.bigint() - t);
  assert.equal(second, first, "второй вызов в тот же день вернул не тот же объект — генерация повторилась");
  assert.ok(secondNs * 10 <= firstNs, `второй вызов ${secondNs} нс, первый ${firstNs} нс`);
  // Следующий день по Москве (16.05 00:30 МСК = 15.05 21:30 UTC) — новые строки.
  const nextDay = demo.getDemoDataAt(new Date("2026-05-15T21:30:00Z"));
  assert.notEqual(nextDay, first);
});

// --- Т07, дефект 3: демо-дашборд «План/факт» через движок, как DashboardWidget ---
// Сценарий приёмки: владелец завёл свой план-проект на демо-датасете (план
// только на октябрь, другие подписи и числа). Демо-дашборд обязан и дальше
// считать по демо-плану: ≈ 88% расход, ≈ 100% установки (калибровка из
// interfaces.md «Демо»), линия плана в комбо — не ноль.
test("Т07-3 демо-дашборд «План/факт» при своём проекте на демо-датасете: ≈88% / ≈100%, линия плана не ноль", () => {
  const engine = require(path.join(ROOT, "lib/query-engine.ts"));
  const filters = require(path.join(ROOT, "lib/dashboard-filters.ts"));
  const userProject = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Мой проект на демо",
    datasetId: demo.DEMO_DATASET_ID,
    dateColumn: "date",
    fields: [
      { id: "u-spend", projectId: "u", label: "Расход", sourceColumn: "spend_rub",
        kind: "volume", direction: "target", sortOrder: 0 },
      { id: "u-inst", projectId: "u", label: "Инсталлы", sourceColumn: "installs",
        kind: "volume", direction: "higher", sortOrder: 1 },
    ],
    values: { "u-spend": { "2026-10": 5000000 }, "u-inst": { "2026-10": 20000 } },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  const projects = [plan.buildDemoPlanProject(NOW), userProject];
  const dash = demo.buildDemoDashboards(NOW).find((d) => d.id === demo.DEMO_PLAN_DASHBOARD_ID);
  const ds = demo.buildDemoDataset(NOW);
  const rows = demo.getDemoDataAt(NOW)[demo.DEMO_TABLE];
  const globalFilters = filters.buildGlobalFilterConditions(dash.filtersConfig, {}, NOW);
  const vizById = new Map(demo.buildDemoVisualizations(NOW).map((v) => [v.id, v]));

  // Как DashboardWidget: проект — по датасету и тому, демо ли объект на экране.
  const ctxFor = (objectId) => {
    const p = plan.planProjectForDataset(projects, ds.id, { demoObject: demo.isDemoObjectId(objectId) });
    return p && { dateColumn: p.dateColumn, fields: p.fields, values: p.values };
  };
  const run = (planCtx, config, chartType = "pivot") =>
    engine.queryRows(
      rows,
      {
        dataSourceId: ds.dataSourceId, datasetId: ds.id, table: ds.table, sqlQuery: ds.sqlQuery,
        chartType, config: { rows: [], columns: [], values: [], ...config, filters: globalFilters },
        calculatedFields: ds.calculatedFields ?? [], plan: planCtx,
      },
      NOW,
    );

  const metric = {};
  const widgets = dash.sheets.flatMap((s) => s.widgets);
  for (const w of widgets.filter((x) => x.widgetType === "metric")) {
    const planCtx = ctxFor(w.id);
    assert.ok(planCtx, `${w.title}: у виджета нет плана`);
    assert.ok(plan.resolvePlanColumn(w.config.column, planCtx.fields), `${w.title}: поле «${w.config.column}» не из плана виджета`);
    const v = { column: w.config.column, aggregation: w.config.aggregation ?? "SUM" };
    metric[w.config.column] = run(planCtx, { values: [v] })[0]?.[`${v.aggregation}(${v.column})`];
  }
  const spend = metric["Расход · выполнение %"];
  const installs = metric["Установки · выполнение %"];
  assert.ok(Math.abs(spend - 88) <= 1, `расход ${spend}%`);
  assert.ok(Math.abs(installs - 100) <= 1, `установки ${installs}%`);

  // Комбо «по дням: факт vs план» — линия плана на каждый день больше нуля.
  const combos = widgets
    .map((w) => w.visualizationId && vizById.get(w.visualizationId))
    .filter((v) => v && v.type === "combo");
  assert.ok(combos.length > 0, "в дашборде нет комбо");
  for (const viz of combos) {
    const lines = viz.config.values.slice(1).filter((v) => v.column.endsWith(" · план"));
    assert.ok(lines.length > 0, `${viz.name}: нет линии плана`);
    const out = run(ctxFor(viz.id), viz.config, "combo");
    assert.ok(out.length > 0, `${viz.name}: пусто`);
    for (const r of out) {
      for (const l of lines) {
        const val = r[`${l.aggregation}(${l.column})`];
        assert.ok(typeof val === "number" && val > 0, `${viz.name} ${r.date}: план ${val}`);
      }
    }
  }
});

// --- Т07, дефект 1: свой план-проект на демо-датасете — сводка с фактом ---
// Обработчик summary читает датасет плана из БД; демо-датасета там нет.
// Подменённая БД: строки datasets нет (как на проде). План октября —
// 3 100 000 ₽ и 20 000 установок; на 20.10 план на дату = план × 20/31.
// Факт — сумма демо-строк 1–20 октября, посчитанная здесь вручную.
test("Т07-1 сводка своего проекта на демо-датасете: факт, выполнение, прогноз — не «датасет не найден»", async () => {
  const summary = require(path.join(ROOT, "lib/plan-summary-server.ts"));
  const emptyDb = {
    from() {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return q;
    },
  };
  const project = {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Мой проект на демо",
    datasetId: demo.DEMO_DATASET_ID,
    dateColumn: "date",
    fields: [
      { id: "u-spend", projectId: "p", label: "Расход", sourceColumn: "spend_rub",
        kind: "volume", direction: "target", format: "currency_rub", sortOrder: 0 },
      { id: "u-inst", projectId: "p", label: "Установки", sourceColumn: "installs",
        kind: "volume", direction: "higher", sortOrder: 1 },
    ],
    values: { "u-spend": { "2026-10": 3100000 }, "u-inst": { "2026-10": 20000 } },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  const src = await summary.planFactSource(project, emptyDb, NOW);
  const res = await summary.buildPlanSummary(project, "2026-10", src, {
    supabase: () => emptyDb,
    now: NOW,
  });
  assert.equal(res.error, undefined, `ошибка сводки: ${res.error}`);
  const oct = demo.getDemoDataAt(NOW)[demo.DEMO_TABLE].filter((r) => r.date.startsWith("2026-10"));
  const factOf = (k) => oct.reduce((s, r) => s + r[k], 0);
  for (const [label, col, monthPlan] of [["Расход", "spend_rub", 3100000], ["Установки", "installs", 20000]]) {
    const f = res.fields.find((x) => x.label === label);
    const fact = factOf(col);
    const planToDate = (monthPlan * 20) / 31;
    assert.ok(fact > 0, `${label}: в демо нет факта за октябрь`);
    assert.ok(Math.abs(f.fact - fact) < 1e-6, `${label}: факт ${f.fact}, ждали ${fact}`);
    assert.ok(Math.abs(f.planToDate - planToDate) < 1e-3, `${label}: план на дату ${f.planToDate}`);
    assert.ok(Math.abs(f.completion - fact / planToDate) < 1e-6, `${label}: выполнение ${f.completion}`);
    assert.ok(Math.abs(f.forecast - (fact / planToDate) * monthPlan) < 1e-3, `${label}: прогноз ${f.forecast}`);
    assert.ok(f.light, `${label}: нет светофора`);
  }
});

// --- Т07, дефект 2: «Собрать дашборд» и «Сохранить» на демо-датасете ---
// Подменённые сторы: если бы сохранение дошло до БД, вызов попал бы в шпион.
test("Т07-2 savePlanDashboard на демо-датасете: понятный текст, в сторы/БД не ходит", async () => {
  const { savePlanDashboard } = require(path.join(ROOT, "components/plan/build-dashboard.ts"));
  const { useVisualizationStore } = require(path.join(ROOT, "stores/visualizationStore.ts"));
  const { useDashboardStore } = require(path.join(ROOT, "stores/dashboardStore.ts"));
  const calls = [];
  useVisualizationStore.setState({ addVisualization: async (v) => { calls.push(["viz", v]); return { ...v, id: "x" }; } });
  useDashboardStore.setState({ createDashboard: async (d) => { calls.push(["dash", d]); return { ...d, id: "y" }; } });
  const project = { ...plan.buildDemoPlanProject(NOW), id: "66666666-6666-6666-6666-666666666666", isDemo: false };
  await assert.rejects(
    () => savePlanDashboard(project, demo.buildDemoDataset(NOW)),
    (e) => e.message === demo.DEMO_SAVE_HINT,
  );
  assert.deepEqual(calls, [], "сохранение ушло в сторы");
  // Тот же текст — у «Сохранить» графика на демо-датасете (настоящий стор, до запроса в БД).
  const fresh = require(path.join(ROOT, "stores/visualizationStore.ts"));
  fresh.useVisualizationStore.setState({ currentUserId: "u" });
  const real = fresh.useVisualizationStore.getInitialState().addVisualization;
  await assert.rejects(
    () => real({ name: "x", datasetId: demo.DEMO_DATASET_ID, type: "bar", config: {}, createdAt: "" }),
    (e) => e.message === demo.DEMO_SAVE_HINT,
  );
});

(async () => {
  for (const { name, fn } of queue) {
    try {
      await fn();
      pass++;
    } catch (e) {
      fail++;
      console.log(`FAIL ${name}\n  ${e && e.message ? e.message.split("\n").join("\n  ") : e}`);
    }
  }
  console.log(`demo: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
