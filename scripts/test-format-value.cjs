/**
 * Проверки чистых функций форматирования для показа (lib/format-value.ts):
 * деньги без копеек от 1 000, отсутствие «-0», русские даты на осях и в
 * тултипах, человеческая подпись значения.
 *
 * Запуск: `node scripts/test-format-value.cjs`. Тестируется РЕАЛЬНЫЙ код:
 * .ts транспилируется на лету (scripts/demo-ts-loader.cjs).
 *
 * Ожидаемые значения — строки из тикета 06 («1 760 000 ₽», «10 230 500 ₽»,
 * «109,12 ₽», «-0» → «0», «02.10», «02.10.26», «02.10.2026», «окт 2026»).
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const { ROOT } = require("./demo-ts-loader.cjs");

const fv = require(path.join(ROOT, "lib/format-value.ts"));

let pass = 0;
let fail = 0;
const queue = [];
function test(name, fn) {
  queue.push({ name, fn });
}

/** Intl в ru-RU ставит неразрывные пробелы — сравниваем с обычными. */
const plain = (s) => String(s).replace(/[  ]/g, " ");

test("деньги: от 1 000 без копеек, меньше 1 000 — с копейками", () => {
  assert.equal(plain(fv.formatCalculatedValue(1760000, "currency_rub")), "1 760 000 ₽");
  assert.equal(plain(fv.formatCalculatedValue(10230500.37, "currency_rub")), "10 230 500 ₽");
  assert.equal(plain(fv.formatCalculatedValue(1000.5, "currency_rub")), "1 001 ₽");
  assert.equal(plain(fv.formatCalculatedValue(109.12, "currency_rub")), "109,12 ₽");
  assert.equal(plain(fv.formatCalculatedValue(-2500.4, "currency_rub")), "-2 500 ₽");
  assert.equal(plain(fv.formatCalculatedValue(12345.67, "currency_usd")), "$12,346");
  assert.equal(plain(fv.formatCalculatedValue(1.5, "currency_usd")), "$1.50");
});

test("нет отрицательного нуля ни в одном формате", () => {
  const cases = [
    [-0, "number", "0"],
    [-0.001, "number", "0"],
    [-0.4, "integer", "0"],
    [-0.004, "currency_rub", "0,00 ₽"],
    [-0.004, "currency_usd", "$0.00"],
    [-0.001, "percent", "0%"],
    [-0.3, undefined, "-0,3"],
  ];
  for (const [v, f, want] of cases) {
    assert.equal(plain(fv.formatCalculatedValue(v, f)), want, `${v} ${f}`);
  }
  // Отклонение плана со знаком: настоящие минусы остаются.
  assert.equal(plain(fv.formatCalculatedValue(-1500, "currency_rub")), "-1 500 ₽");
});

test("даты: ось «02.10» (шире года — «02.10.26»), тултип «02.10.2026», месяц «окт 2026»", () => {
  assert.equal(fv.formatDateAxis("2026-10-02"), "02.10");
  assert.equal(fv.formatDateAxis("2026-10-02", { wide: true }), "02.10.26");
  assert.equal(fv.formatDateTooltip("2026-10-02"), "02.10.2026");
  // ClickHouse/Postgres отдают дату со временем — время полуночи не показываем.
  assert.equal(fv.formatDateTooltip("2026-10-02T00:00:00.000Z"), "02.10.2026");
  assert.equal(fv.formatDateTooltip("2026-10-02 14:30:00"), "02.10.2026 14:30");
  assert.equal(fv.formatDateAxis("2026-10"), "окт 2026");
  assert.equal(fv.formatDateTooltip("2026-01"), "янв 2026");
  // Не дата — как есть.
  assert.equal(fv.formatDateAxis("Яндекс"), "Яндекс");
  assert.equal(fv.formatDateTooltip(42), "42");
  // Период шире года: 01.09.2025 … 02.10.2026 — да; 01.08 … 20.10.2026 — нет.
  assert.equal(fv.isWideDateRange(["2025-09-01", "2026-10-02"]), true);
  assert.equal(fv.isWideDateRange(["2026-08-01", "2026-10-20"]), false);
  assert.equal(fv.isWideDateRange(["Яндекс", "VK"]), false);
});

test("подпись значения: описание колонки + агрегация по-русски; вычисляемое поле — своим именем", () => {
  // Описания — как у колонок демо-датасета (lib/demo-data.ts, COLUMN_META.label).
  const datasetColumns = [
    { name: "spend_rub", description: "Расход ₽" },
    { name: "installs", description: "Установки" },
    { name: "spend_usd", description: "Расход, $ (по курсу 92.5 ₽)" },
    { name: "geo_code", description: "" },
    { name: "date", description: "Дата" },
  ];
  const calculatedFields = [{ name: "CPI ₽" }, { name: "Расход · план" }];
  const ctx = { datasetColumns, calculatedFields };
  assert.equal(fv.valueLabel({ column: "spend_rub", aggregation: "SUM" }, ctx), "Расход ₽, сумма");
  assert.equal(fv.valueLabel({ column: "installs", aggregation: "AVG" }, ctx), "Установки, среднее");
  assert.equal(fv.valueLabel({ column: "installs", aggregation: "COUNT" }, ctx), "Установки, количество");
  assert.equal(fv.valueLabel({ column: "installs", aggregation: "MIN" }, ctx), "Установки, минимум");
  assert.equal(fv.valueLabel({ column: "installs", aggregation: "MAX" }, ctx), "Установки, максимум");
  // Короткая часть описания — до запятой/скобки.
  assert.equal(fv.valueLabel({ column: "spend_usd", aggregation: "SUM" }, ctx), "Расход, сумма");
  // Без описания — имя колонки.
  assert.equal(fv.valueLabel({ column: "geo_code", aggregation: "SUM" }, ctx), "geo_code, сумма");
  // Вычисляемое поле и поле плана — без агрегации.
  assert.equal(fv.valueLabel({ column: "CPI ₽", aggregation: "SUM" }, ctx), "CPI ₽");
  assert.equal(fv.valueLabel({ column: "Расход · план", aggregation: "SUM" }, ctx), "Расход · план");
  // Измерение — описание колонки.
  assert.equal(fv.columnLabel("date", ctx), "Дата");
  assert.equal(fv.columnLabel("CPI ₽", ctx), "CPI ₽");
  assert.equal(fv.columnLabel("unknown", ctx), "unknown");
  // Без контекста — сырое имя, но агрегация всё равно по-русски (никаких «SUM …»).
  assert.equal(fv.valueLabel({ column: "spend_rub", aggregation: "SUM" }), "spend_rub, сумма");
});

test("formatNumber и formatCompletionPercent: без «-0»", () => {
  const { formatNumber } = require(path.join(ROOT, "lib/utils.ts"));
  const { formatCompletionPercent } = require(path.join(ROOT, "lib/plan/display.ts"));
  assert.equal(formatNumber(-0.3, 0), "0");
  assert.equal(formatNumber(-0.004, 2), "0,00");
  assert.equal(formatNumber(-0, 1), "0,0");
  assert.equal(plain(formatNumber(-1234.4, 0)), "-1 234");
  assert.equal(formatCompletionPercent(-0.04), "0%");
  assert.equal(formatCompletionPercent(-0.049), "0%");
  assert.equal(formatCompletionPercent(-0.6), "-0,6%");
  assert.equal(formatCompletionPercent(88), "88%");
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
  console.log(`format-value: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
