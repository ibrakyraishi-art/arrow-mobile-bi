/**
 * Тесты in-JS ветки общего движка запросов (lib/query-engine.ts) — тот же
 * код, которым считают /api/query и /api/plan/[id]/summary для демо- и
 * файловых источников.
 *
 * Запуск: `node scripts/test-query-engine.cjs` — сперва компилирует
 * lib/query-engine.ts в node_modules/.cache/engine-test через tsc (как
 * test:plan), затем гоняет проверки через публичные экспорты.
 *
 * Ожидаемые числа посчитаны вручную в комментариях или взяты из
 * спецификации (история 27: план 3 100 000, 19 дней, факт 1 672 000 → 88%).
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "node_modules/.cache/engine-test");
execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules/typescript/bin/tsc"),
    "lib/query-engine.ts",
    "lib/dashboard-filters.ts",
    "--outDir", outDir,
    "--rootDir", "lib",
    "--module", "commonjs",
    "--target", "es2020",
    "--moduleResolution", "node",
    "--strict",
    "--skipLibCheck",
  ],
  { cwd: root, stdio: "inherit" },
);
const engine = require(path.join(outDir, "query-engine.js"));
const plan = require(path.join(outDir, "plan/index.js"));
const filters = require(path.join(outDir, "dashboard-filters.js"));

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
function near(got, want, msg) {
  assert.ok(typeof got === "number", `${msg}: ожидалось число, пришло ${got}`);
  assert.ok(Math.abs(got - want) < 1e-6, `${msg}: got ${got}, want ${want}`);
}
/** Даты YYYY-MM-DD с from по to включительно. */
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
/** 19 октября 2026, полдень по Москве. */
const OCT_19 = new Date("2026-10-19T09:00:00Z");

function body(config, extra) {
  return {
    dataSourceId: "x",
    datasetId: "d",
    table: "t",
    sqlQuery: null,
    chartType: "pivot",
    config: { rows: [], columns: [], values: [], filters: [], ...config },
    ...extra,
  };
}

// Маленький набор: A — 100 + 30 = 130, B — 50.
const SMALL = [
  { date: "2026-10-01", client: "A", spend_rub: 100, installs: 2 },
  { date: "2026-10-01", client: "B", spend_rub: 50, installs: 1 },
  { date: "2026-10-02", client: "A", spend_rub: 30, installs: 3 },
];

test("без plan: сводная по клиенту — суммы как посчитано вручную", () => {
  const out = engine.queryRows(
    SMALL,
    body({ rows: ["client"], values: [{ column: "spend_rub", aggregation: "SUM" }] }),
    OCT_19,
  );
  assert.deepEqual(out, [
    { client: "A", "SUM(spend_rub)": 130 },
    { client: "B", "SUM(spend_rub)": 50 },
  ]);
});

// Демо-план на 19.10.2026: «Расход» октября = 3 100 000 (DEMO_PLAN_MONTHLY[0]),
// 31 день → дневной план 100 000. Факт — 88 000 в день с 1 по 19 октября,
// у двух клиентов по 44 000: итог 1 672 000 (история 27).
const DEMO_PLAN = plan.buildDemoPlanProject(OCT_19);
const PLAN_CTX = {
  dateColumn: DEMO_PLAN.dateColumn,
  fields: DEMO_PLAN.fields,
  values: DEMO_PLAN.values,
};
const OCT_ROWS = days("2026-10-01", "2026-10-19").flatMap((date) => [
  { date, client: "A", spend_rub: 44000, installs: 400 },
  { date, client: "B", spend_rub: 44000, installs: 400 },
]);

test("план по дате: «· план» — дневной план 100 000, выполнение 88% в каждый день", () => {
  const out = engine.queryRows(
    OCT_ROWS,
    body(
      {
        xAxis: "date",
        values: [
          { column: "spend_rub", aggregation: "SUM" },
          { column: "Расход · план", aggregation: "SUM" },
          { column: "Расход · выполнение %", aggregation: "SUM" },
        ],
      },
      { chartType: "combo", plan: PLAN_CTX },
    ),
    OCT_19,
  );
  assert.equal(out.length, 19, "строка на каждый день");
  for (const r of out) {
    near(r["SUM(spend_rub)"], 88000, `факт ${r.date}`);
    near(r["SUM(Расход · план)"], 100000, `дневной план ${r.date}`);
    near(r["SUM(Расход · выполнение %)"], 88, `выполнение ${r.date}`);
  }
});

test("без группировки: план месяца, план на дату, 88%, прогноз; факт, которого не просили, не утекает", () => {
  const out = engine.queryRows(
    OCT_ROWS,
    body(
      {
        values: [
          { column: "Расход · план", aggregation: "SUM" },
          { column: "Расход · план на дату", aggregation: "SUM" },
          { column: "Расход · выполнение %", aggregation: "SUM" },
          { column: "Расход · прогноз", aggregation: "SUM" },
          { column: "Расход · отклонение", aggregation: "SUM" },
        ],
      },
      { plan: PLAN_CTX },
    ),
    OCT_19,
  );
  assert.equal(out.length, 1);
  const r = out[0];
  near(r["SUM(Расход · план)"], 3100000, "план месяца");
  near(r["SUM(Расход · план на дату)"], 1900000, "план на дату (19 × 100 000)");
  near(r["SUM(Расход · выполнение %)"], 88, "выполнение 1 672 000 / 1 900 000");
  near(r["SUM(Расход · прогноз)"], 2728000, "прогноз 0.88 × 3 100 000");
  near(r["SUM(Расход · отклонение)"], -228000, "1 672 000 − 1 900 000");
  assert.deepEqual(
    new Set(Object.keys(r)),
    new Set([
      "SUM(Расход · план)",
      "SUM(Расход · план на дату)",
      "SUM(Расход · выполнение %)",
      "SUM(Расход · прогноз)",
      "SUM(Расход · отклонение)",
    ]),
    "в ответе только запрошенные колонки",
  );
});

test("разрез по клиенту (вне плана): факт делится, план общий на проект (история 30)", () => {
  const out = engine.queryRows(
    OCT_ROWS,
    body(
      {
        rows: ["client"],
        values: [
          { column: "spend_rub", aggregation: "SUM" },
          { column: "Расход · план", aggregation: "SUM" },
          { column: "Расход · выполнение %", aggregation: "SUM" },
        ],
      },
      { plan: PLAN_CTX },
    ),
    OCT_19,
  );
  assert.equal(out.length, 2);
  for (const r of out) {
    near(r["SUM(spend_rub)"], 836000, `факт ${r.client} = 19 × 44 000`);
    near(r["SUM(Расход · план)"], 3100000, `план ${r.client} общий`);
    near(r["SUM(Расход · выполнение %)"], 44, `${r.client}: 836 000 / 1 900 000`);
  }
});

test("plan передан, но виртуальных колонок нет — ответ как без plan", () => {
  const cfg = { rows: ["client"], values: [{ column: "spend_rub", aggregation: "SUM" }] };
  const out = engine.queryRows(SMALL, body(cfg, { plan: PLAN_CTX }), OCT_19);
  assert.deepEqual(out, [
    { client: "A", "SUM(spend_rub)": 130 },
    { client: "B", "SUM(spend_rub)": 50 },
  ]);
});

// --- ClickHouse: имя колонки даты плана проверяется до сборки SQL -------------
test("validateForSql: dateColumn плана с SQL-инъекцией отклоняется", () => {
  const evil = "date`) FROM t; DROP TABLE users; --";
  const b = body(
    { values: [{ column: "Расход · выполнение %", aggregation: "SUM" }] },
    { plan: { ...PLAN_CTX, dateColumn: evil } },
  );
  const err = engine.validateForSql(engine.prepareQuery(b), b);
  assert.equal(typeof err, "string", "ожидалась ошибка валидации");
  assert.ok(err.includes("даты плана"), `текст ошибки: ${err}`);
  // Та же конфигурация с нормальной колонкой даты проходит.
  const okBody = body(
    { values: [{ column: "Расход · выполнение %", aggregation: "SUM" }] },
    { plan: PLAN_CTX },
  );
  assert.equal(engine.validateForSql(engine.prepareQuery(okBody), okBody), null);
});

// --- Относительный период шаблона (Решения §10) ------------------------------
test("шаблон собран в сентябре, открыт в октябре → период «октябрь»", () => {
  const SEP_15 = new Date("2026-09-15T09:00:00Z");
  const draft = plan.buildPlanDashboard(
    DEMO_PLAN,
    { id: "ds", columns: [], calculatedFields: [] },
    { now: SEP_15 },
  );
  const conds = filters.buildGlobalFilterConditions(draft.filtersConfig, {}, OCT_19);
  assert.deepEqual(
    conds.map((c) => [c.operator, c.value]),
    [
      [">=", "2026-10-01"],
      ["<=", "2026-10-31"],
    ],
  );
});
test("старый фиксированный дефолт {from,to} работает как раньше", () => {
  const f = [{ id: "p", column: "date", label: "Период", type: "date_range",
    defaultValue: { from: "2026-09-01", to: "2026-09-30" } }];
  const conds = filters.buildGlobalFilterConditions(f, {}, OCT_19);
  assert.deepEqual(conds.map((c) => c.value), ["2026-09-01", "2026-09-30"]);
  // Явно очищенный пользователем фильтр к дефолту не откатывается.
  assert.deepEqual(filters.buildGlobalFilterConditions(f, { p: {} }, OCT_19), []);
});

// --- Т07, дефект 4: план только на октябрь, данные июль–октябрь, без фильтра ---
// План вписан только на октябрь (3 100 000, дневной 100 000). Факт октября —
// 88 000 в день с 1 по 19 (1 672 000, история 27); июль–сентябрь — по 50 000
// в день, плана на них нет. Без фильтра периода выполнение/прогноз/отклонение
// обязаны совпасть со сводкой за октябрь: 88%, 2 728 000, −228 000.
const OCT_ONLY_PLAN = {
  dateColumn: "date",
  fields: [
    { id: "f-spend", projectId: "p", label: "Расход", sourceColumn: "spend_rub",
      kind: "volume", direction: "target", sortOrder: 0 },
  ],
  values: { "f-spend": { "2026-10": 3100000 } },
};
const JUL_OCT_ROWS = [
  ...days("2026-07-01", "2026-09-30").map((date) => ({ date, client: "A", spend_rub: 50000 })),
  ...days("2026-10-01", "2026-10-19").map((date) => ({ date, client: "A", spend_rub: 88000 })),
];
const COMPLETION_VALUES = [
  { column: "Расход · выполнение %", aggregation: "SUM" },
  { column: "Расход · прогноз", aggregation: "SUM" },
  { column: "Расход · отклонение", aggregation: "SUM" },
];
function assertOctoberSummary(r, where) {
  near(r["SUM(Расход · выполнение %)"], 88, `${where}: выполнение 1 672 000 / 1 900 000`);
  near(r["SUM(Расход · прогноз)"], 2728000, `${where}: прогноз`);
  near(r["SUM(Расход · отклонение)"], -228000, `${where}: отклонение`);
}

test("Т07-4 in-JS: план только на октябрь, без фильтра периода — выполнение как в сводке за октябрь", () => {
  const out = engine.queryRows(
    JUL_OCT_ROWS,
    body({ values: COMPLETION_VALUES }, { plan: OCT_ONLY_PLAN }),
    OCT_19,
  );
  assert.equal(out.length, 1);
  assertOctoberSummary(out[0], "без фильтра");
  // Та же сводка с фильтром «октябрь» — те же числа.
  const oct = engine.queryRows(
    JUL_OCT_ROWS,
    body(
      {
        values: COMPLETION_VALUES,
        filters: [
          { id: "a", column: "date", operator: ">=", value: "2026-10-01" },
          { id: "b", column: "date", operator: "<=", value: "2026-10-31" },
        ],
      },
      { plan: OCT_ONLY_PLAN },
    ),
    OCT_19,
  );
  assertOctoberSummary(oct[0], "октябрь");
});

test("Т07-4 ClickHouse: запрос дат несёт сумму факта по дням, выполнение как в сводке за октябрь", () => {
  const b = body({ values: COMPLETION_VALUES }, { plan: OCT_ONLY_PLAN });
  const q = engine.prepareQuery(b);
  const sql = engine.buildPlanDatesSql(q, "`db`.`t`");
  assert.ok(sql, "запрос дат нужен: группировка не по дате");
  assert.ok(sql.includes("sum(`spend_rub`)"), `в запросе дат нет суммы факта: ${sql}`);
  // Ответ ClickHouse имитируем руками: основной запрос — итог за все месяцы
  // (92 × 50 000 + 1 672 000 = 6 272 000), запрос дат — по строке на день.
  const main = [{ "SUM(spend_rub)": 6272000 }];
  const dateRows = JUL_OCT_ROWS.map((r) => ({
    [engine.PLAN_DATE_KEY]: r.date,
    "SUM(spend_rub)": String(r.spend_rub), // 64-битные числа ClickHouse отдаёт строками
  }));
  const out = engine.attachPlanColumns(
    main,
    engine.datesByGroupFromDateRows(dateRows, q.groupBy),
    q,
    OCT_19,
    engine.planFactsByDateFromRows(dateRows, q, engine.PLAN_DATE_KEY),
  );
  assertOctoberSummary(out[0], "ClickHouse без фильтра");
});

test("Т07-4 группы нет в факте по дням — выполнение/прогноз/отклонение объёма null, а не факт за все месяцы", () => {
  const q = engine.prepareQuery(body({ values: COMPLETION_VALUES }, { plan: OCT_ONLY_PLAN }));
  const dateRows = JUL_OCT_ROWS.map((r) => ({ [engine.PLAN_DATE_KEY]: r.date }));
  const out = engine.attachPlanColumns(
    [{ "SUM(spend_rub)": 6272000 }],
    engine.datesByGroupFromDateRows(dateRows, q.groupBy),
    q,
    OCT_19,
    new Map(), // факт по дням есть, но этой группы в нём нет
  );
  assert.equal(out[0]["SUM(Расход · выполнение %)"], null);
  assert.equal(out[0]["SUM(Расход · прогноз)"], null);
  assert.equal(out[0]["SUM(Расход · отклонение)"], null);
});

test("Т07-4 запрос дат упёрся в LIMIT — факт по дням не используется, объём null и пометка", () => {
  const q = engine.prepareQuery(body({ values: COMPLETION_VALUES }, { plan: OCT_ONLY_PLAN }));
  assert.ok(engine.buildPlanDatesSql(q, "`db`.`t`").endsWith(`LIMIT ${engine.PLAN_DATES_LIMIT}`));
  const full = Array.from({ length: engine.PLAN_DATES_LIMIT }, () => ({
    [engine.PLAN_DATE_KEY]: "2026-10-01",
    "SUM(spend_rub)": "1",
  }));
  const cut = engine.planDailyFactsFromDateRows(full, q);
  assert.equal(typeof cut.warning, "string", "нет пометки об обрезке");
  const out = engine.attachPlanColumns(
    [{ "SUM(spend_rub)": 6272000 }],
    engine.datesByGroupFromDateRows(full, q.groupBy),
    q,
    OCT_19,
    cut.factsByKey,
  );
  assert.equal(out[0]["SUM(Расход · выполнение %)"], null);
  // Меньше лимита — без пометки, факт по дням как есть.
  const ok = engine.planDailyFactsFromDateRows(full.slice(1), q);
  assert.equal(ok.warning, undefined);
  assert.ok(ok.factsByKey.get("").hasOwnProperty("2026-10-01"));
});

if (fail > 0) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`query-engine: ${pass} passed`);
