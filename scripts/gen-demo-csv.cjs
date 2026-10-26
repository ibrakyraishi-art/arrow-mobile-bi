/**
 * Пишет public/demo/arrow-mobile-demo.csv из того же генератора, что и демо в
 * приложении (lib/demo-data.ts). Файл коммитится — его скачивают из «Помощи»
 * и экрана нового источника, чтобы потренироваться загружать CSV.
 *
 * Запуск: `npm run demo:csv` (на сегодня по Москве) или
 * `npm run demo:csv -- 2026-10-20` (на заданный день).
 */
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./demo-ts-loader.cjs");

const demo = require(path.join(ROOT, "lib/demo-data.ts"));

const arg = process.argv[2];
if (arg && !/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
  console.error(`Дата должна быть в формате YYYY-MM-DD, получено: ${arg}`);
  process.exit(1);
}
// Полдень по Москве — чтобы дата не съехала из-за часового пояса машины.
const now = arg ? new Date(`${arg}T09:00:00Z`) : new Date();
const rows = demo.generateDemoRows(now);
const out = path.join(ROOT, "public", "demo", demo.DEMO_CSV_FILENAME);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, demo.demoRowsToCsv(rows), "utf8");
console.log(`${path.relative(ROOT, out)}: ${rows.length} строк, ${rows[0].date} … ${rows[rows.length - 1].date}`);
