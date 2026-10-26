/**
 * Детерминированные тесты ядра токенизации (lib/anonymize.ts).
 *
 * Запуск: `npm run test:anonymize` — сперва компилирует lib/anonymize.ts в
 * .anon-test/ через tsc, затем гоняет этот файл. Браузер не нужен.
 *
 * Тестируется РЕАЛЬНЫЙ код (а не копия). `import "server-only"` в либе —
 * безвредный side-effect в Node; перехватываем require, чтобы он не бросал.
 */
const Module = require("module");
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "server-only") return {};
  return originalRequire.apply(this, arguments);
};

const anon = require("../.anon-test/anonymize.js");
const {
  createReverseReplacer,
  maskText,
  maskRows,
  extendAnonState,
  emptyAnonState,
  parseAnonState,
  buildReverseMap,
  buildValuePairs,
  distinctCount,
  rowsToCsv,
  HIGH_CARDINALITY_THRESHOLD,
} = anon;

let pass = 0;
let fail = 0;
function eq(name, got, want) {
  const g = typeof got === "string" ? got : JSON.stringify(got);
  const w = typeof want === "string" ? want : JSON.stringify(want);
  if (g === w) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}\n  got : ${g}\n  want: ${w}`);
  }
}
function ok(name, cond) {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}: expected truthy`);
  }
}

// --- Стриминговая обратная замена (самое хрупкое) -------------------------
const rev = { SRC_07: "Nike", GEO_03: "Germany", CAMP_01: "BlackFriday" };
function run(chunks) {
  const r = createReverseReplacer(rev);
  let out = "";
  for (const c of chunks) out += r.push(c);
  return out + r.flush();
}
eq("split-many", run(["S", "R", "C", "_", "0", "7", " done"]), "Nike done");
eq("split-mid", run(["...SR", "C_07", " more"]), "...Nike more");
eq("code-at-end", run(["total ", "GEO_03"]), "total Germany");
eq("md-bold", run(["**SRC_07", "** rocks"]), "**Nike** rocks");
eq("digit-extend", run(["SRC_0", "7", " x"]), "Nike x");
eq("allcaps-word", run(["ROI is ", "high"]), "ROI is high");
eq("two-codes", run(["SRC_07 vs ", "GEO_03!"]), "Nike vs Germany!");
eq("table-cell", run(["| ", "CAMP_01", " | 100 |"]), "| BlackFriday | 100 |");
eq("single-letter-join", run(["price S", "RC_07 end"]), "price Nike end");
eq("plain", run(["just plain text"]), "just plain text");
eq("unknown-code-kept", run(["SRC_07", "8 oops"]), "SRC_078 oops");

// --- maskText (свободный текст) -------------------------------------------
eq("mask-substring", maskText("RUB and RU", [["RU", "GEO_01"]]), "RUB and GEO_01");
eq("mask-regexchars", maskText("a (b) c", [["(b)", "X_01"]]), "a X_01 c");
eq(
  "mask-longest-first",
  maskText("Nike Air vs Nike", [["Nike Air", "C_02"], ["Nike", "C_01"]]),
  "C_02 vs C_01",
);
eq("mask-empty-pairs", maskText("hello", []), "hello");
eq("mask-word-boundary", maskText("Nikes are Nike", [["Nike", "C_01"]]), "Nikes are C_01");

// --- extendAnonState / maskRows: консистентность и стабильность -----------
{
  const rows = [
    { source: "Nike", spend: 100 },
    { source: "Adidas", spend: 50 },
    { source: "Nike", spend: 20 },
  ];
  const { state, changed } = extendAnonState(emptyAnonState(), rows, ["source"]);
  ok("extend-changed", changed === true);
  const m = maskRows(rows, ["source"], state);
  eq("code-1", m[0].source, "SRC_01");
  eq("code-2", m[1].source, "SRC_02");
  eq("same-value-same-code", m[2].source, "SRC_01");
  eq("number-untouched", m[0].spend, 100);
  const r = buildReverseMap(state);
  eq("reverse-1", r["SRC_01"], "Nike");
  eq("reverse-2", r["SRC_02"], "Adidas");

  // append-only: новые значения добавляются, старые коды стабильны
  const { state: s2, changed: c2 } = extendAnonState(
    state,
    [{ source: "Nike" }, { source: "Puma" }],
    ["source"],
  );
  ok("extend-added-new", c2 === true);
  eq("stable-old", maskRows([{ source: "Nike" }], ["source"], s2)[0].source, "SRC_01");
  eq("new-next-index", maskRows([{ source: "Puma" }], ["source"], s2)[0].source, "SRC_03");
  const { changed: c3 } = extendAnonState(s2, [{ source: "Nike" }], ["source"]);
  ok("noop-no-change", c3 === false);
}

// --- Уникальность префиксов при коллизии имён ------------------------------
{
  const rows = [{ source: "A", src_extra: "X" }];
  const { state } = extendAnonState(emptyAnonState(), rows, ["source", "src_extra"]);
  const m = maskRows(rows, ["source", "src_extra"], state)[0];
  ok("prefix-src", m.source.startsWith("SRC_"));
  ok("prefix-collision-resolved", m.src_extra.startsWith("SRCB_"));
  ok("codes-distinct", m.source !== m.src_extra);
}

// --- Разные известные столбцы → разные префиксы ----------------------------
{
  const rows = [{ campaign: "Promo", geo: "DE" }];
  const { state } = extendAnonState(emptyAnonState(), rows, ["campaign", "geo"]);
  const m = maskRows(rows, ["campaign", "geo"], state)[0];
  eq("campaign-prefix", m.campaign, "CAMP_01");
  eq("geo-prefix", m.geo, "GEO_01");
}

// --- null / пустые ячейки не маскируются -----------------------------------
{
  const rows = [{ source: null }, { source: "" }, { source: "  " }, { source: "Nike" }];
  const { state } = extendAnonState(emptyAnonState(), rows, ["source"]);
  const m = maskRows(rows, ["source"], state);
  eq("null-kept", m[0].source, null);
  eq("empty-kept", m[1].source, "");
  eq("ws-kept", m[2].source, "  ");
  eq("only-real-masked", m[3].source, "SRC_01");
}

// --- maskText через словарь проекта (длинное первым) -----------------------
{
  const { state } = extendAnonState(
    emptyAnonState(),
    [{ source: "Nike Air" }, { source: "Nike" }],
    ["source"],
  );
  const pairs = buildValuePairs(state);
  eq(
    "mask-via-state",
    maskText("Spend on Nike Air and Nike", pairs),
    "Spend on SRC_01 and SRC_02",
  );
}

// --- parseAnonState фоллбэки -----------------------------------------------
eq("parse-null", JSON.stringify(parseAnonState(null)), JSON.stringify(emptyAnonState()));
eq("parse-garbage", JSON.stringify(parseAnonState("{bad json")), JSON.stringify(emptyAnonState()));
ok("parse-roundtrip", parseAnonState(JSON.stringify({ version: 1, columns: { source: { prefix: "SRC", values: { Nike: "SRC_01" }, next: 2 } } })).columns.source.values.Nike === "SRC_01");

// --- distinctCount + порог -------------------------------------------------
eq("distinct", distinctCount([{ c: "a" }, { c: "b" }, { c: "a" }, { c: null }], "c"), 2);
ok("threshold", HIGH_CARDINALITY_THRESHOLD === 300);

// --- rowsToCsv экранирование -----------------------------------------------
eq("csv-escape", rowsToCsv([{ a: "x,y", b: 1 }]), 'a,b\n"x,y",1');
eq("csv-empty", rowsToCsv([]), "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
