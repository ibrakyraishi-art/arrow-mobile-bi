/**
 * Тесты математики плана (lib/plan) — шов модуля `plan`.
 *
 * Запуск: `npm run test:plan` — сперва компилирует lib/plan в
 * node_modules/.cache/plan-test через tsc, затем гоняет этот файл.
 * Тестируется РЕАЛЬНЫЙ код (а не копия), только через публичные экспорты.
 *
 * Ожидаемые числа — из спецификации (истории 26–31, Решения §7, §10) или
 * посчитаны вручную в комментарии рядом, а не тем же кодом.
 */
const assert = require("node:assert/strict");
const plan = require("../node_modules/.cache/plan-test/plan/index.js");

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.log(`FAIL ${name}\n  ${e && e.message ? e.message.split("\n").join("\n  ") : e}`);
  }
}
/** Сравнение чисел с допуском на плавающую точку. */
function near(got, want, msg) {
  assert.ok(typeof got === "number", `${msg}: ожидалось число, пришло ${got}`);
  assert.ok(Math.abs(got - want) < 1e-6, `${msg}: got ${got}, want ${want}`);
}
/** Даты YYYY-MM-DD с from по to включительно (UTC, без зависимостей от кода). */
function days(from, to) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
/** 19 октября 2026, полдень по Москве (09:00 UTC). */
const OCT_19 = new Date("2026-10-19T09:00:00Z");

function field(over) {
  return {
    id: "f-spend",
    projectId: "p1",
    label: "Расход",
    sourceColumn: "spend_rub",
    kind: "volume",
    direction: "higher",
    format: "currency_rub",
    sortOrder: 0,
    ...over,
  };
}

// --- История 27: темп с начала месяца ---------------------------------------
// План 3 100 000 на октябрь (31 день) → 100 000 в день; прошло 19 дней →
// план на дату 1 900 000; факт 1 672 000 → 88%; прогноз 0.88 × 3 100 000 = 2 728 000.
test("история 27: план на дату / выполнение / прогноз / отклонение", () => {
  const f = field({});
  const ctx = { dateColumn: "date", fields: [f], values: { "f-spend": { "2026-10": 3100000 } } };
  const [row] = plan.fillPlanColumns(
    [{ row: {}, facts: { spend_rub: 1672000 }, dates: days("2026-10-01", "2026-10-19") }],
    ctx,
    OCT_19,
  );
  near(row["Расход · план"], 3100000, "план");
  near(row["Расход · план на дату"], 1900000, "план на дату");
  near(row["Расход · выполнение %"], 88, "выполнение %");
  near(row["Расход · прогноз"], 2728000, "прогноз");
  near(row["Расход · отклонение"], 1672000 - 1900000, "отклонение");
});

// --- История 26: направление «меньше — лучше» (CPI) ---------------------------
// План CPI 120 ₽, факт 150 ₽ → план ÷ факт = 120 / 150 = 0.8 (хуже плана);
// факт 100 ₽ → 120 / 100 = 1.2 (лучше плана). «Больше — лучше» с теми же числами — 150 / 120 = 1.25.
test("история 26: lower = план ÷ факт, higher = факт ÷ план", () => {
  near(plan.completion(150, 120, "lower"), 0.8, "lower, дороже плана");
  near(plan.completion(100, 120, "lower"), 1.2, "lower, дешевле плана");
  near(plan.completion(150, 120, "higher"), 1.25, "higher");
});

// --- История 31: светофор, ровно на границах ---------------------------------
test("история 31: higher/lower — 95% ok, 80% warn, ниже 80% bad", () => {
  for (const dir of ["higher", "lower"]) {
    assert.equal(plan.trafficLight(0.95, dir), "ok", `${dir} 95%`);
    assert.equal(plan.trafficLight(1.4, dir), "ok", `${dir} 140%`);
    assert.equal(plan.trafficLight(0.9499, dir), "warn", `${dir} 94.99%`);
    assert.equal(plan.trafficLight(0.8, dir), "warn", `${dir} 80%`);
    assert.equal(plan.trafficLight(0.7999, dir), "bad", `${dir} 79.99%`);
  }
  // Чуть ниже границы — уже не зелёный: 94.996% < 95%.
  assert.equal(plan.trafficLight(0.94996, "higher"), "warn", "94.996%");
  assert.equal(plan.trafficLight(0.94996, "target"), "warn", "target 94.996%");
  assert.equal(plan.trafficLight(1.05004, "target"), "warn", "target 105.004%");
  assert.equal(plan.trafficLight(0.79996, "higher"), "bad", "79.996%");
  // 88% из истории 27 — жёлтый.
  assert.equal(plan.trafficLight(0.88, "higher"), "warn");
});
test("история 31: target — 95..105 ok, 85..95 и 105..115 warn, иначе bad", () => {
  const t = (x) => plan.trafficLight(x, "target");
  assert.equal(t(0.95), "ok", "95%");
  assert.equal(t(1.0), "ok", "100%");
  assert.equal(t(1.05), "ok", "105%");
  assert.equal(t(1.0501), "warn", "105.01%");
  assert.equal(t(1.15), "warn", "115%");
  assert.equal(t(1.1501), "bad", "115.01%");
  assert.equal(t(0.9499), "warn", "94.99%");
  assert.equal(t(0.85), "warn", "85%");
  assert.equal(t(0.8499), "bad", "84.99%");
  assert.equal(t(0.8), "bad", "80% для target уже красный");
});
test("светофор без значения — null", () => {
  assert.equal(plan.trafficLight(null, "higher"), null);
});

// --- История 26 + 31: «ближе к плану», перерасход -----------------------------
// План на дату 1 900 000 (как в истории 27), факт 2 090 000 → 2 090 000 / 1 900 000 = 110% —
// для «ближе к плану» это перерасход → жёлтый; для «больше — лучше» те же 110% — зелёный.
test("target: перерасход 110% → warn", () => {
  const f = field({ direction: "target" });
  const ctx = { dateColumn: "date", fields: [f], values: { "f-spend": { "2026-10": 3100000 } } };
  const [row] = plan.fillPlanColumns(
    [{ row: {}, facts: { spend_rub: 2090000 }, dates: days("2026-10-01", "2026-10-19") }],
    ctx,
    OCT_19,
  );
  near(row["Расход · выполнение %"], 110, "выполнение %");
  assert.equal(plan.completionColumnLight(row["Расход · выполнение %"], "target"), "warn");
  assert.equal(plan.completionColumnLight(row["Расход · выполнение %"], "higher"), "ok");
});

// --- История 29: ставка не делится на дни, а взвешивается по дням -----------
// CPI: сентябрь 120 ₽, октябрь 150 ₽. Группа: 21–30 сентября (10 дней) + 1–20 октября (20 дней).
// План = (10 × 120 + 20 × 150) / 30 = 4200 / 30 = 140. Факт 112 → lower: 140 / 112 = 125%.
// Прогноза у ставки нет. Отклонение 112 − 140 = −28.
test("история 29: ставка взвешивается по дням двух месяцев", () => {
  const cpi = field({ id: "f-cpi", label: "CPI", sourceColumn: "CPI ₽", kind: "rate", direction: "lower" });
  const ctx = { dateColumn: "date", fields: [cpi], values: { "f-cpi": { "2026-09": 120, "2026-10": 150 } } };
  const [row] = plan.fillPlanColumns(
    [{ row: { client: "A" }, facts: { "CPI ₽": 112 }, dates: [...days("2026-09-21", "2026-09-30"), ...days("2026-10-01", "2026-10-20")] }],
    ctx,
    new Date("2026-10-25T09:00:00Z"),
  );
  near(row["CPI · план"], 140, "план");
  near(row["CPI · план на дату"], 140, "план на дату");
  near(row["CPI · выполнение %"], 125, "выполнение %");
  assert.equal(row["CPI · прогноз"], null, "прогноз у ставки");
  near(row["CPI · отклонение"], -28, "отклонение");
  assert.equal(row.client, "A", "измерения группы сохраняются");
});

// --- История 28: группировка по дате даёт дневной план ------------------------
// Сентябрь 2 700 000 / 30 дней = 90 000 в день; октябрь 3 100 000 / 31 = 100 000 в день.
// 1 октября факт 95 000 → 95 000 / 100 000 = 95%.
test("история 28: по дате «· план» — дневной план своего месяца", () => {
  const f = field({});
  const ctx = { dateColumn: "date", fields: [f], values: { "f-spend": { "2026-09": 2700000, "2026-10": 3100000 } } };
  const rows = plan.fillPlanColumns(
    [
      { row: { date: "2026-09-30 00:00:00" }, facts: { spend_rub: 90000 }, dates: ["2026-09-30 00:00:00"], groupedByDate: true },
      { row: { date: "2026-10-01" }, facts: { spend_rub: 95000 }, dates: ["2026-10-01"], groupedByDate: true },
    ],
    ctx,
    OCT_19,
  );
  near(rows[0]["Расход · план"], 90000, "сентябрь, дневной план");
  near(rows[1]["Расход · план"], 100000, "октябрь, дневной план");
  near(rows[1]["Расход · план на дату"], 100000, "октябрь, план на дату");
  near(rows[1]["Расход · выполнение %"], 95, "выполнение");
  assert.equal(rows[1].date, "2026-10-01", "ключ даты сохраняется");
});

// Без явного groupedByDate ключ даты в строке ничего не значит: «· план» — полный план месяца.
test("ключ даты в строке без groupedByDate → полный план месяца (3 100 000)", () => {
  const f = field({});
  const ctx = { dateColumn: "date", fields: [f], values: { "f-spend": { "2026-10": 3100000 } } };
  const [row] = plan.fillPlanColumns(
    [{ row: { date: "2026-10-01" }, facts: { spend_rub: 95000 }, dates: ["2026-10-01"] }],
    ctx,
    OCT_19,
  );
  near(row["Расход · план"], 3100000, "план без флага");
});

// --- История 30: разрез по колонке вне плана — план общий на проект ----------
// Канал A есть все 19 дней, канал B — только 5 дней. План на дату у обоих — общий: 1 900 000.
test("история 30: в разрезе по каналу план общий, факт свой", () => {
  const f = field({});
  const ctx = { dateColumn: "date", fields: [f], values: { "f-spend": { "2026-10": 3100000 } } };
  const rows = plan.fillPlanColumns(
    [
      { row: { channel: "A" }, facts: { spend_rub: 1000000 }, dates: days("2026-10-01", "2026-10-19") },
      { row: { channel: "B" }, facts: { spend_rub: 380000 }, dates: days("2026-10-01", "2026-10-05") },
    ],
    ctx,
    OCT_19,
  );
  near(rows[0]["Расход · план на дату"], 1900000, "A");
  near(rows[1]["Расход · план на дату"], 1900000, "B");
  near(rows[1]["Расход · выполнение %"], 20, "B: 380 000 / 1 900 000");
  const hint = plan.planVirtualFields({ fields: [f] }).find((v) => v.name === "Расход · план").description;
  assert.match(hint, /общий/, "подсказка говорит про общий план");
});

// --- Решения §7: нет плана / деление на 0 → null ------------------------------
test("пустой план → все поля плана null, факт не трогаем", () => {
  const f = field({});
  const ctx = { dateColumn: "date", fields: [f], values: {} };
  const [row] = plan.fillPlanColumns(
    [{ row: { "SUM(spend_rub)": 500 }, facts: { spend_rub: 500 }, dates: days("2026-10-01", "2026-10-19") }],
    ctx,
    OCT_19,
  );
  for (const k of ["план", "план на дату", "выполнение %", "прогноз", "отклонение"]) {
    assert.equal(row[`Расход · ${k}`], null, k);
  }
  assert.equal(row["SUM(spend_rub)"], 500);
});
test("план 0 → выполнение и прогноз null (деление на 0)", () => {
  const f = field({});
  const ctx = { dateColumn: "date", fields: [f], values: { "f-spend": { "2026-10": 0 } } };
  const [row] = plan.fillPlanColumns(
    [{ row: {}, facts: { spend_rub: 500 }, dates: days("2026-10-01", "2026-10-19") }],
    ctx,
    OCT_19,
  );
  assert.equal(row["Расход · выполнение %"], null);
  assert.equal(row["Расход · прогноз"], null);
  assert.equal(plan.completion(0, 120, "lower"), null, "lower при факте 0");
  assert.equal(plan.completion(500, null, "higher"), null, "нет плана");
});

// --- «Сегодня» по Москве ------------------------------------------------------
// 19 октября 21:30 UTC = 20 октября 00:30 МСК → прошло 20 дней → 20 × 100 000 = 2 000 000.
test("сегодня считается по Europe/Moscow", () => {
  const f = field({});
  const ctx = { dateColumn: "date", fields: [f], values: { "f-spend": { "2026-10": 3100000 } } };
  const [row] = plan.fillPlanColumns(
    [{ row: {}, facts: { spend_rub: 1 }, dates: days("2026-10-01", "2026-10-31") }],
    ctx,
    new Date("2026-10-19T21:30:00Z"),
  );
  near(row["Расход · план на дату"], 2000000, "план на дату");
});

// --- История 21: значения по умолчанию для нового поля -------------------------
test("история 21: CPI → ставка + меньше; расход → объём + ближе к плану", () => {
  assert.deepEqual(plan.suggestPlanFieldDefaults("CPI ₽"), { kind: "rate", direction: "lower" });
  assert.deepEqual(plan.suggestPlanFieldDefaults("spend_rub"), { kind: "volume", direction: "target" });
  assert.deepEqual(plan.suggestPlanFieldDefaults("installs"), { kind: "volume", direction: "higher" });
});

// --- Решения §10: состав шаблона дашборда план/факт ---------------------------
// 5 полей (3 объёма + 2 ставки). Лист «План/факт» по §10:
//   5 метрик `· выполнение %` (third) + 1 progress + 3 combo (по объёмам) + 1 сводная = 10 виджетов,
//   визуализаций 1 + 3 + 1 = 5; сводная — 5 полей × 5 значений (план, план на дату, факт, %, откл.) = 25.
const P_FIELDS = [
  field({ id: "a", label: "Расход", sourceColumn: "spend_rub", direction: "target", sortOrder: 0 }),
  field({ id: "b", label: "Установки", sourceColumn: "installs", sortOrder: 1, format: undefined }),
  field({ id: "c", label: "Покупки", sourceColumn: "purchases", sortOrder: 2, format: undefined }),
  field({ id: "d", label: "CPI", sourceColumn: "CPI ₽", kind: "rate", direction: "lower", sortOrder: 3 }),
  field({ id: "e", label: "ROAS", sourceColumn: "ROAS %", kind: "rate", sortOrder: 4, format: "percent" }),
];
const P_PROJECT = {
  id: "p1", name: "Яндекс", datasetId: "ds1", dateColumn: "date", fields: P_FIELDS, values: {},
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
};
const P_DATASET = {
  id: "ds1", name: "Яндекс", dataSourceId: "src", table: "t", sqlQuery: null, createdAt: "",
  calculatedFields: [], businessContext: "", kpiProfile: {},
  columns: ["date", "client", "channel", "spend_rub", "installs", "purchases"].map((name) => ({ name })),
};
function widgetsOf(sheet) { return sheet.widgets; }
test("buildPlanDashboard: лист «План/факт» по §10", () => {
  const d = plan.buildPlanDashboard(P_PROJECT, P_DATASET, { now: OCT_19 });
  assert.equal(d.datasetId, "ds1");
  assert.equal(d.sheets.length, 1, "без разреза — один лист");
  const s = d.sheets[0];
  assert.equal(s.name, "План/факт");
  const w = widgetsOf(s);
  assert.equal(w.length, 10, "виджетов");
  assert.equal(d.visualizations.length, 5, "визуализаций");

  const metrics = w.filter((x) => x.widgetType === "metric");
  assert.deepEqual(
    metrics.map((x) => x.config.column),
    ["Расход · выполнение %", "Установки · выполнение %", "Покупки · выполнение %", "CPI · выполнение %", "ROAS · выполнение %"],
  );
  assert.ok(metrics.every((x) => x.width === "third"), "метрики в треть ширины");
  assert.equal(metrics[0].config.caption.column, "Расход · прогноз", "под метрикой объёма — прогноз");

  const vizById = Object.fromEntries(d.visualizations.map((v) => [v.id, v]));
  const linked = w.filter((x) => x.visualizationId).map((x) => vizById[x.visualizationId]);
  assert.equal(linked.length, 5, "все визуализации стоят на листе");
  assert.ok(linked.every(Boolean), "виджеты ссылаются на визуализации черновика");

  const progress = linked.filter((v) => v.type === "progress");
  assert.equal(progress.length, 1);
  assert.equal(progress[0].config.values.length, 5);

  const combos = linked.filter((v) => v.type === "combo");
  assert.deepEqual(
    combos.map((v) => v.config.values.map((x) => x.column)),
    [["spend_rub", "Расход · план"], ["installs", "Установки · план"], ["purchases", "Покупки · план"]],
  );
  assert.ok(combos.every((v) => v.config.xAxis === "date"), "комбо по дате");

  const pivots = linked.filter((v) => v.type === "pivot");
  assert.equal(pivots.length, 1);
  assert.equal(pivots[0].config.values.length, 25);
  assert.ok(d.visualizations.every((v) => v.datasetId === "ds1"));
});
// §10 после ревью (D03): в «Разрезах» на колонку — сводная «<колонка> → факт» по
// объёмам, столбцы факта и круговая доля в факте; без «· выполнение %» и без
// progress/светофора. Подписи — описание колонки («Клиент»), а не `client`.
test("buildPlanDashboard: разрезы client + channel → факт и доля, без выполнения; подписи человеческие", () => {
  const dataset = {
    ...P_DATASET,
    columns: P_DATASET.columns.map((c) =>
      c.name === "client" ? { ...c, description: "Клиент — приложение" } : c,
    ),
  };
  const d = plan.buildPlanDashboard(P_PROJECT, dataset, { now: OCT_19, breakdownColumn: ["client", "channel", "нет_такой"] });
  assert.equal(d.sheets.length, 2);
  const cuts = d.sheets[1];
  assert.equal(cuts.name, "Разрезы");
  const vizById = Object.fromEntries(d.visualizations.map((v) => [v.id, v]));
  const vizs = cuts.widgets.map((x) => vizById[x.visualizationId]);
  assert.ok(vizs.every(Boolean), "виджеты ссылаются на визуализации");
  const used = vizs.flatMap((v) => [...v.config.values, ...(v.config.yAxis ? [v.config.yAxis] : [])].map((x) => x.column));
  assert.ok(!used.some((c) => c.includes("· выполнение %")), `в «Разрезах» нет выполнения: ${used.join(", ")}`);
  assert.ok(!used.some((c) => c.includes(" · ")), "в «Разрезах» нет полей плана вообще");
  assert.ok(!vizs.some((v) => v.type === "progress"), "нет progress (светофора)");
  const dims = (v) => v.config.rows[0] ?? v.config.xAxis;
  assert.deepEqual([...new Set(vizs.map(dims))], ["client", "channel"]);
  // Сводная по колонке: факт трёх объёмов (ставки в разрез не идут).
  const pivots = vizs.filter((v) => v.type === "pivot");
  assert.equal(pivots.length, 2);
  assert.deepEqual(pivots[0].config.values.map((x) => x.column), ["spend_rub", "installs", "purchases"]);
  assert.ok(vizs.some((v) => v.type === "bar" && v.config.xAxis === "client"), "столбцы факта по клиенту");
  // Подписи: описание колонки до «—»; без описания — имя колонки.
  assert.ok(vizs.filter((v) => dims(v) === "client").every((v) => v.name.includes("Клиент") && !v.name.includes("client")));
  assert.ok(cuts.widgets.every((w) => w.title === vizById[w.visualizationId].name));
  const ids = [...d.visualizations.map((v) => v.id), ...d.sheets.flatMap((s) => [s.id, ...s.widgets.map((x) => x.id)])];
  assert.equal(new Set(ids).size, ids.length, "временные id уникальны");
});

test("planDashboardName — имя шаблона по умолчанию", () => {
  assert.equal(plan.planDashboardName({ name: "Яндекс" }), "План/факт: Яндекс");
  assert.equal(plan.buildPlanDashboard(P_PROJECT, P_DATASET, { now: OCT_19 }).name, "План/факт: Яндекс");
});

test("подпись светофора зависит от направления: перерасход — не «отстаём»", () => {
  assert.equal(plan.trafficLightLabel("ok", "target"), "в плане");
  assert.ok(!/отста/.test(plan.trafficLightLabel("warn", "target")));
  assert.ok(!/отста/.test(plan.trafficLightLabel("bad", "target")));
  assert.equal(plan.trafficLightLabel("warn", "higher"), "отстаём");
  assert.equal(plan.trafficLightLabel("bad", "lower"), "сильно отстаём");
});

// Т07, дефект 2: визуализации в БД ссылаются на datasets (uuid + FK), демо-
// датасета "demo-dataset-installs" там нет — сохранять шаблон на нём нельзя
// («invalid input syntax for type uuid»). На демо-датасете кнопка ведёт в
// готовый демо-дашборд, на своём датасете — собирает шаблон.
test("Т07-2 «Собрать дашборд»: на демо-датасете — готовый демо-дашборд, на своём — сборка", () => {
  const own = { id: "33333333-3333-3333-3333-333333333333", datasetId: "4f1c2a9e-0000-4000-8000-000000000001" };
  const onDemo = { id: "44444444-4444-4444-4444-444444444444", datasetId: "demo-dataset-installs" };
  assert.deepEqual(plan.planDashboardTarget(onDemo), { kind: "demo" });
  assert.deepEqual(plan.planDashboardTarget(plan.buildDemoPlanProject(OCT_19)), { kind: "demo" });
  assert.deepEqual(plan.planDashboardTarget(own), { kind: "build" });
});

// Т07, дефект 3: свой проект на демо-датасете не подменяет план демо-объектов
// (демо-график в конструкторе, AddWidgetDialog на демо-дашборде, виджеты).
test("Т07-3 planProjectForDataset: демо-объекту — демо-план, обычному — свой проект", () => {
  const demoProject = plan.buildDemoPlanProject(OCT_19);
  const own = { id: "55555555-5555-5555-5555-555555555555", datasetId: "demo-dataset-installs",
    dateColumn: "date", fields: [], values: {}, createdAt: "", updatedAt: "" };
  const projects = [demoProject, own];
  assert.equal(plan.planProjectForDataset(projects, "demo-dataset-installs", { demoObject: true }).id, "demo-plan-project");
  assert.equal(plan.planProjectForDataset(projects, "demo-dataset-installs", { demoObject: false }).id, own.id);
  assert.equal(plan.planProjectForDataset(projects, "demo-dataset-installs").id, own.id);
  // Без своего проекта обычный объект тоже видит демо-план; чужой датасет — ничего.
  assert.equal(plan.planProjectForDataset([demoProject], "demo-dataset-installs").id, "demo-plan-project");
  assert.equal(plan.planProjectForDataset(projects, "other", { demoObject: true }), undefined);
});

// Т08, п.5: подпись поля плана по умолчанию — не сырое имя колонки.
// Ожидания — строки из тикета 08: описание колонки, иначе словарь частых имён
// (spend→«Расход», installs→«Установки», …; _rub/_usd → « ₽»/« $»), иначе имя.
test("Т08-5 suggestPlanFieldLabel: описание колонки → словарь → имя колонки", () => {
  const ds = { columns: [
    { name: "spend_rub", description: "" },
    { name: "installs", description: "" },
    { name: "cost", description: "Затраты на закупку — из кабинетов" },
  ] };
  // Описание колонки датасета приоритетнее словаря (как datasetColumnLabel).
  assert.equal(plan.suggestPlanFieldLabel(ds, "cost"), "Затраты на закупку");
  assert.equal(plan.suggestPlanFieldLabel(ds, "spend_rub"), "Расход ₽");
  assert.equal(plan.suggestPlanFieldLabel(ds, "spend_usd"), "Расход $");
  assert.equal(plan.suggestPlanFieldLabel(ds, "installs"), "Установки");
  assert.equal(plan.suggestPlanFieldLabel(ds, "purchases"), "Покупки");
  assert.equal(plan.suggestPlanFieldLabel(ds, "revenue_rub"), "Выручка ₽");
  assert.equal(plan.suggestPlanFieldLabel(ds, "clicks"), "Клики");
  assert.equal(plan.suggestPlanFieldLabel(ds, "impressions"), "Показы");
  assert.equal(plan.suggestPlanFieldLabel(ds, "registrations"), "Регистрации");
  assert.equal(plan.suggestPlanFieldLabel(ds, "cpi"), "CPI");
  assert.equal(plan.suggestPlanFieldLabel(ds, "ROAS"), "ROAS");
  // Нет ни описания, ни слова в словаре — имя колонки как есть.
  assert.equal(plan.suggestPlanFieldLabel(ds, "geo_rub"), "geo_rub");
  assert.equal(plan.suggestPlanFieldLabel(ds, "CPI ₽"), "CPI ₽");
});

// Т09-3а: на датасете два проекта (сценарий приёмки: «Пример» и «Приёмка 2»).
// Дашборд, собранный из «Приёмки 2», обязан считать по «Приёмке 2», а не по
// первому проекту датасета. Старые объекты без id — как раньше (первый свой).
test("Т09-3а planProjectForDataset: явный id проекта из дашборда побеждает «первый на датасете»", () => {
  const first = { ...P_PROJECT, id: "11111111-aaaa-4000-8000-000000000001", name: "Пример: демо CSV" };
  const second = { ...P_PROJECT, id: "22222222-bbbb-4000-8000-000000000002", name: "Приёмка 2" };
  const elsewhere = { ...P_PROJECT, id: "33333333-cccc-4000-8000-000000000003", datasetId: "ds-other" };
  const projects = [first, second, elsewhere];

  const d = plan.buildPlanDashboard(second, P_DATASET, { now: OCT_19 });
  const ids = [
    ...d.visualizations.map((v) => v.config.planProjectId),
    ...d.sheets.flatMap((s) => s.widgets.filter((w) => w.widgetType === "metric").map((w) => w.config.planProjectId)),
  ];
  assert.ok(ids.length > 0);
  for (const id of ids) {
    assert.equal(plan.planProjectForDataset(projects, "ds1", { projectId: id }).name, "Приёмка 2");
  }
  // Без id (данные до фикса) — прежнее правило: первый свой проект датасета.
  assert.equal(plan.planProjectForDataset(projects, "ds1").name, "Пример: демо CSV");
  assert.equal(plan.planProjectForDataset(projects, "ds1", { projectId: undefined }).name, "Пример: демо CSV");
  // Проект удалён или он с другого датасета — тоже прежнее правило.
  assert.equal(plan.planProjectForDataset(projects, "ds1", { projectId: "нет-такого" }).name, "Пример: демо CSV");
  assert.equal(plan.planProjectForDataset(projects, "ds1", { projectId: elsewhere.id }).name, "Пример: демо CSV");
});

// Т09-3б: «проект = датасет целиком» (Q6). Второй свой проект на датасете
// создать нельзя; демо-проект на демо-датасете не считается.
test("Т09-3б canCreatePlanProject: занятый своим проектом датасет — нельзя, демо-проект не мешает", () => {
  const demoProject = plan.buildDemoPlanProject(OCT_19);
  const taken = { ...P_PROJECT, id: "11111111-aaaa-4000-8000-000000000001", name: "Пример: демо CSV", datasetId: "ds-csv" };
  const projects = [demoProject, taken];

  assert.deepEqual(plan.canCreatePlanProject(projects, "ds-csv"), { ok: false, existing: taken });
  assert.deepEqual(plan.canCreatePlanProject(projects, "ds-free"), { ok: true });
  assert.deepEqual(plan.canCreatePlanProject([], "ds-csv"), { ok: true });
  // На демо-датасете есть только демо-проект — свой создать можно.
  assert.deepEqual(plan.canCreatePlanProject(projects, "demo-dataset-installs"), { ok: true });
  // …а после этого — уже нет.
  const ownOnDemo = { ...P_PROJECT, id: "44444444-dddd-4000-8000-000000000004", name: "Мой демо", datasetId: "demo-dataset-installs" };
  assert.deepEqual(plan.canCreatePlanProject([...projects, ownOnDemo], "demo-dataset-installs"), { ok: false, existing: ownOnDemo });
});

// Т09 ремонт: на датасете уже лежат два старых проекта (созданы до запрета).
// Переименовать или сменить колонку даты любому из них можно — датасет тот же;
// перенести третий проект на этот датасет — нельзя.
test("Т09-ремонт canCreatePlanProject: правка проекта на прежнем датасете проходит, даже если там два проекта", () => {
  const a = { ...P_PROJECT, id: "11111111-aaaa-4000-8000-000000000001", name: "Пример: демо CSV", datasetId: "ds-csv" };
  const b = { ...P_PROJECT, id: "22222222-bbbb-4000-8000-000000000002", name: "Приёмка 2", datasetId: "ds-csv" };
  const c = { ...P_PROJECT, id: "33333333-cccc-4000-8000-000000000003", name: "Другой", datasetId: "ds-other" };
  const projects = [a, b, c];
  assert.deepEqual(plan.canCreatePlanProject(projects, "ds-csv", b), { ok: true });
  assert.deepEqual(plan.canCreatePlanProject(projects, "ds-csv", a), { ok: true });
  assert.deepEqual(plan.canCreatePlanProject(projects, "ds-csv", c), { ok: false, existing: a });
  // Свой датасет не мешает уйти на свободный.
  assert.deepEqual(plan.canCreatePlanProject(projects, "ds-free", b), { ok: true });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
