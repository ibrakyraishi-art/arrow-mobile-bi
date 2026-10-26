/**
 * Тест разбора ввода ячейки сетки плана (components/plan/parse-number.ts).
 *
 * Запуск: `npm run test:plan-input` — сперва компилирует
 * components/plan/parse-number.ts в node_modules/.cache/plan-input-test через
 * tsc, затем гоняет этот файл (по образцу `test:plan`).
 *
 * Ожидаемые значения — из тикета 05 («3 100 000,5» понимается; пустое = нет
 * плана; нечисловое не сохраняется) и разобраны вручную, а не тем же кодом.
 */
const assert = require("node:assert/strict");
const { parsePlanInput, formatPlanInput } = require("../node_modules/.cache/plan-input-test/parse-number.js");

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.log(`FAIL ${name}\n  ${e && e.message ? e.message : e}`);
  }
}

test("пробелы-разделители тысяч и запятая-дробь: «3 100 000,5» → 3100000.5", () => {
  assert.deepEqual(parsePlanInput("3 100 000,5"), { ok: true, value: 3100000.5 });
});

test("пустая ячейка и одни пробелы = плана нет (null)", () => {
  assert.deepEqual(parsePlanInput(""), { ok: true, value: null });
  assert.deepEqual(parsePlanInput("   "), { ok: true, value: null });
});

test("нечисловой ввод не сохраняется: буквы, два разделителя дроби, минус, экспонента", () => {
  for (const bad of ["abc", "12о", "1,2,3", "1.2.3", "1,5.5", "-5", "1e5", "∞", "три"]) {
    assert.deepEqual(parsePlanInput(bad), { ok: false }, `«${bad}»`);
  }
});

test("неразрывные пробелы (так копируется из Excel/ru-RU) и хвост ₽/%", () => {
  assert.deepEqual(parsePlanInput("3\u00a0100\u202f000"), { ok: true, value: 3100000 });
  assert.deepEqual(parsePlanInput("3 100 000 ₽"), { ok: true, value: 3100000 });
  assert.deepEqual(parsePlanInput("120%"), { ok: true, value: 120 });
  assert.deepEqual(parsePlanInput("0,5"), { ok: true, value: 0.5 });
});

test("показ значения в ячейке: разряды пробелом, дробь запятой — и читается обратно", () => {
  assert.equal(formatPlanInput(3100000.5), "3 100 000,5");
  assert.equal(formatPlanInput(25000), "25 000");
  assert.equal(formatPlanInput(1.25), "1,25");
  assert.equal(formatPlanInput(null), "");
  assert.deepEqual(parsePlanInput(formatPlanInput(3100000.5)), { ok: true, value: 3100000.5 });
});

console.log(`plan-input: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
