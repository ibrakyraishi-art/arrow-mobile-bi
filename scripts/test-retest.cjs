/**
 * Проверки по ручному перетесту на проде (таск 08): сторы с подменённой БД
 * и чистые функции форм.
 *
 * Запуск: `node scripts/test-retest.cjs`. Тестируется РЕАЛЬНЫЙ код сторов:
 * .ts транспилируется на лету (scripts/demo-ts-loader.cjs), а модуль
 * `lib/supabase-db.ts` подменяется шпионом до загрузки сторов — сеть не нужна.
 *
 * Ожидания — из тикета 08: таймаут ≈ 15 с и текст «Не удалось сохранить —
 * проверьте связь»; «dark → light» оставляет light и в localStorage, и в БД.
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const { ROOT } = require("./demo-ts-loader.cjs");

// --- Подмена БД: любой экспорт supabase-db — шпион, поведение задаёт тест. ---
const dbImpl = {};
const dbCalls = [];
const fakeDb = new Proxy(
  {},
  {
    get(_t, name) {
      if (name === "__esModule") return true;
      return (...args) => {
        dbCalls.push([name, ...args]);
        const impl = dbImpl[name];
        if (!impl) return Promise.reject(new Error(`db.${String(name)} не задан в тесте`));
        return impl(...args);
      };
    },
  },
);
const dbPath = path.join(ROOT, "lib/supabase-db.ts");
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

// --- Браузерные глобалы: localStorage в памяти. ---
const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
};

/** Управляемые таймеры: копим, срабатывают по команде теста. */
function fakeTimers() {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const timers = new Map();
  let next = 1;
  globalThis.setTimeout = (fn, ms) => {
    const id = next++;
    timers.set(id, { fn, ms });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  return {
    timers,
    fire(id) {
      const t = timers.get(id);
      timers.delete(id);
      t.fn();
    },
    restore() {
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
    },
  };
}

/** Промис, которым управляет тест (запрос «висит», пока не решим). */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));

let pass = 0;
let fail = 0;
const queue = [];
function test(name, fn) {
  queue.push({ name, fn });
}

// --- п.3: зависший запрос стора плана → таймаут ≈ 15 с и понятная ошибка ---
test("Т08-3 setValue: зависший запрос → через ≈15 с ошибка «Не удалось сохранить — проверьте связь»", async () => {
  const { usePlanStore } = require(path.join(ROOT, "stores/planStore.ts"));
  const fieldId = "f-1";
  usePlanStore.getState().hydrate([
    {
      id: "77777777-7777-7777-7777-777777777777",
      name: "Тест",
      datasetId: "d",
      dateColumn: "date",
      fields: [{ id: fieldId, projectId: "p", label: "Расход", sourceColumn: "spend_rub",
        kind: "volume", direction: "target", format: "currency_rub", sortOrder: 0 }],
      values: {},
      createdAt: "",
      updatedAt: "",
    },
  ]);
  dbImpl.setPlanValue = () => new Promise(() => {}); // сеть повисла навсегда
  const clock = fakeTimers();
  let settled = null;
  try {
    usePlanStore.getState().setValue(fieldId, "2026-10", 3100000).then(
      () => (settled = { ok: true }),
      (e) => (settled = { ok: false, e }),
    );
    await tick();
    assert.equal(settled, null, "запрос ещё висит — ошибки быть не должно");
    const timeouts = [...clock.timers].filter(([, t]) => t.ms >= 10000 && t.ms <= 20000);
    assert.equal(timeouts.length, 1, `нет таймера ≈15 с: ${[...clock.timers.values()].map((t) => t.ms)}`);
    clock.fire(timeouts[0][0]);
    await tick();
  } finally {
    clock.restore();
  }
  assert.ok(settled && !settled.ok, "setValue не завершился ошибкой после таймаута");
  assert.match(settled.e.message, /Не удалось сохранить — проверьте связь/);
});

test("Т08-3 load: зависшая загрузка план-проектов → ошибка после таймаута, лоадер снят", async () => {
  const { usePlanStore } = require(path.join(ROOT, "stores/planStore.ts"));
  usePlanStore.getState().reset();
  dbImpl.getPlanProjects = () => new Promise(() => {});
  const clock = fakeTimers();
  let done = false;
  try {
    usePlanStore.getState().load().then(() => (done = true));
    await tick();
    assert.equal(usePlanStore.getState().loading, true);
    const timeouts = [...clock.timers].filter(([, t]) => t.ms >= 10000 && t.ms <= 20000);
    assert.equal(timeouts.length, 1, "нет таймера ≈15 с у загрузки");
    clock.fire(timeouts[0][0]);
    await tick();
  } finally {
    clock.restore();
  }
  assert.ok(done, "load() не завершился");
  const s = usePlanStore.getState();
  assert.equal(s.loading, false);
  assert.equal(s.loaded, true);
  assert.match(s.error ?? "", /проверьте связь/);
});

// Создание/удаление по таймауту могло всё же пройти — стор перечитывает список,
// чтобы повтор не дал дубль, а удалённый проект не остался «призраком».
for (const op of ["createProject", "deleteProject"]) {
  test(`Т08-3 ${op}: таймаут → ошибка и перечитанный список проектов`, async () => {
    const { usePlanStore } = require(path.join(ROOT, "stores/planStore.ts"));
    const pid = "99999999-9999-4999-8999-999999999999";
    const proj = { id: pid, name: "Был", datasetId: "d", dateColumn: "date", fields: [], values: {}, createdAt: "", updatedAt: "" };
    usePlanStore.getState().reset();
    usePlanStore.getState().hydrate(op === "deleteProject" ? [proj] : []);
    // В БД операция на самом деле прошла: создан proj / proj удалён.
    const dbList = op === "createProject" ? [{ ...proj, name: "Новый" }] : [];
    dbImpl.getPlanProjects = async () => dbList;
    dbImpl.createPlanProject = () => new Promise(() => {});
    dbImpl.deletePlanProject = () => new Promise(() => {});
    const clock = fakeTimers();
    let err = null;
    try {
      const call = op === "createProject"
        ? usePlanStore.getState().createProject({ name: "Новый", datasetId: "d", dateColumn: "date" })
        : usePlanStore.getState().deleteProject(pid);
      call.catch((e) => (err = e));
      await tick();
      const [id] = [...clock.timers].find(([, t]) => t.ms >= 10000 && t.ms <= 20000);
      clock.fire(id);
      for (let i = 0; i < 5; i++) await tick();
    } finally {
      clock.restore();
    }
    assert.ok(err, "операция не завершилась ошибкой");
    const own = usePlanStore.getState().projects.filter((p) => !p.isDemo);
    assert.deepEqual(own.map((p) => p.name), dbList.map((p) => p.name), "список не перечитан из БД");
  });
}

// --- п.2: тема — последний выбор пользователя побеждает ---
const THEME_KEY = "ai-gomobile.theme"; // ключ из interfaces.md (THEME_STORAGE_KEY)

/** Фейковая user_settings: значение меняется, когда запись «дошла» (промис решён). */
function fakeSettingsDb() {
  const db = { theme: "dark", writes: [] };
  dbImpl.upsertUserSettings = (_uid, patch) => {
    const d = deferred();
    db.writes.push({ theme: patch.theme, d });
    return d.promise.then(() => {
      db.theme = patch.theme;
      return { theme: patch.theme, providerKeys: {} };
    });
  };
  return db;
}

test("Т08-2 «dark → light»: в localStorage и в БД остаётся light, даже если запись dark дошла позже", async () => {
  const { useSettingsStore } = require(path.join(ROOT, "stores/settingsStore.ts"));
  storage.clear();
  const db = fakeSettingsDb();
  useSettingsStore.getState().hydrate("u1", { theme: "light", providerKeys: {} }, []);
  const p1 = useSettingsStore.getState().setTheme("dark");
  const p2 = useSettingsStore.getState().setTheme("light");
  await tick();
  // Сеть: ответ на вторую запись приходит раньше первой.
  for (const w of [...db.writes].reverse()) w.d.resolve();
  await tick();
  // Если стор досылает запись после ответа на первую — даём ей дойти.
  for (let i = 0; i < 5; i++) {
    for (const w of db.writes) w.d.resolve();
    await tick();
  }
  await Promise.all([p1, p2]);
  assert.equal(storage.get(THEME_KEY), "light");
  assert.equal(useSettingsStore.getState().settings.theme, "light");
  assert.equal(db.writes.at(-1).theme, "light", "последней в БД ушла не light");
  assert.equal(db.theme, "light", "в БД осталась dark");
});

test("Т08-2 загрузка из БД (bootstrap) не перетирает выбор, сделанный после её старта", async () => {
  const { useSettingsStore } = require(path.join(ROOT, "stores/settingsStore.ts"));
  useSettingsStore.getState().reset();
  storage.clear();
  const db = fakeSettingsDb(); // в БД — dark
  // Как StoreSync.bootstrap: сначала loading: true, потом — ответ сервера.
  useSettingsStore.setState({ loading: true });
  await useSettingsStore.getState().setTheme("light"); // сессии в сторе ещё нет
  useSettingsStore.getState().hydrate("u2", { theme: "dark", providerKeys: {} }, []);
  assert.equal(useSettingsStore.getState().settings.theme, "light", "ответ загрузки перетёр выбор");
  assert.equal(storage.get(THEME_KEY), "light");
  // Выбор досылается в БД, как только известен пользователь.
  await tick();
  for (const w of db.writes) w.d.resolve();
  await tick();
  assert.deepEqual(db.writes.map((w) => w.theme), ["light"]);
  assert.equal(db.theme, "light");
});

test("Т08-2 loadFromSupabase: выбор во время запроса сильнее ответа; без выбора — тема из БД", async () => {
  const { useSettingsStore } = require(path.join(ROOT, "stores/settingsStore.ts"));
  const db = fakeSettingsDb();
  dbImpl.getAnalyses = async () => [];
  // Без ручного выбора — тема пользователя из БД (тема не своя, а сохранённая).
  dbImpl.getUserSettings = async () => ({ theme: "dark", providerKeys: {} });
  useSettingsStore.getState().reset();
  await useSettingsStore.getState().loadFromSupabase("u3");
  assert.equal(useSettingsStore.getState().settings.theme, "dark");
  // Выбор посреди запроса настроек.
  const slow = deferred();
  dbImpl.getUserSettings = () => slow.promise;
  const loading = useSettingsStore.getState().loadFromSupabase("u3");
  const choice = useSettingsStore.getState().setTheme("light");
  await tick();
  for (const w of db.writes) w.d.resolve(); // запись light дошла раньше ответа загрузки
  await choice;
  slow.resolve({ theme: "dark", providerKeys: {} }); // устаревший ответ
  await loading;
  assert.equal(useSettingsStore.getState().settings.theme, "light");
  assert.equal(db.theme, "light");
});

test("Т08-2 reset (выход): неотправленный выбор прежнего пользователя не навязывается следующему", async () => {
  const { useSettingsStore } = require(path.join(ROOT, "stores/settingsStore.ts"));
  const db = fakeSettingsDb(); // у следующего пользователя в БД — dark
  useSettingsStore.getState().reset();
  await useSettingsStore.getState().setTheme("light"); // сессии нет — в БД не ушло
  useSettingsStore.getState().reset(); // выход
  useSettingsStore.setState({ loading: true });
  useSettingsStore.getState().hydrate("u4", { theme: "dark", providerKeys: {} }, []);
  await tick();
  assert.equal(useSettingsStore.getState().settings.theme, "dark");
  assert.deepEqual(db.writes, [], "в БД нового пользователя ушла чужая тема");
});

// --- п.1: редактор датасета при прямом заходе / перезагрузке ---
// Ожидания — из тикета: пока датасет не загружен — загрузка; форма — только
// данными этого датасета; несуществующий id — «датасет не найден».
test("Т08-1 datasetEditorView: до загрузки — loading, после — данные этого датасета или not_found", () => {
  const { datasetEditorView } = require(path.join(ROOT, "app/(app)/datasets/[id]/editor-state.ts"));
  const id = "8a6e0f1c-1111-4222-8333-444455556666";
  const own = { id, name: "Мой CSV", dataSourceId: "src-file", table: "data", sqlQuery: null, columns: [] };
  const demoDs = { id: "demo-dataset-installs", name: "Демо", dataSourceId: "demo-clickhouse", columns: [] };
  const fileSource = { id: "src-file", kind: "file" };
  const demoSource = { id: "demo-clickhouse", isDemo: true };

  // Прямой заход: сторы ещё не загружены, в них только демо.
  assert.deepEqual(
    datasetEditorView({ id, datasets: [demoDs], datasetsLoaded: false, sources: [demoSource], sourcesLoaded: false }),
    { state: "loading" },
  );
  // Датасеты пришли, источники ещё нет — форму ещё рано заполнять (иначе источник «не тот»).
  assert.deepEqual(
    datasetEditorView({ id, datasets: [demoDs, own], datasetsLoaded: true, sources: [demoSource], sourcesLoaded: false }),
    { state: "loading" },
  );
  // Всё загружено — редактор получает именно этот датасет.
  const ready = datasetEditorView({ id, datasets: [demoDs, own], datasetsLoaded: true, sources: [demoSource, fileSource], sourcesLoaded: true });
  assert.equal(ready.state, "edit");
  assert.equal(ready.dataset, own);
  // Несуществующий id после загрузки — «не найден», а не пустая форма с демо-источником.
  assert.deepEqual(
    datasetEditorView({ id: "00000000-0000-4000-8000-000000000000", datasets: [demoDs, own], datasetsLoaded: true, sources: [demoSource], sourcesLoaded: true }),
    { state: "not_found" },
  );
  // Новый датасет не ждёт загрузки.
  assert.deepEqual(
    datasetEditorView({ id: "new", datasets: [demoDs], datasetsLoaded: false, sources: [demoSource], sourcesLoaded: false }),
    { state: "new" },
  );
  // Демо-датасет живёт в памяти — доступен сразу.
  const demo = datasetEditorView({ id: demoDs.id, datasets: [demoDs], datasetsLoaded: false, sources: [demoSource], sourcesLoaded: false });
  assert.equal(demo.state, "edit");
  assert.equal(demo.dataset, demoDs);
});

test("Т08-1 загрузка датасетов упала: «не загрузилось», а не «датасет не найден»", async () => {
  const { datasetEditorView } = require(path.join(ROOT, "app/(app)/datasets/[id]/editor-state.ts"));
  const { useDatasetStore } = require(path.join(ROOT, "stores/datasetStore.ts"));
  dbImpl.getDatasets = async () => {
    throw new Error("Failed to fetch");
  };
  await useDatasetStore.getState().loadFromSupabase("u5");
  const s = useDatasetStore.getState();
  const id = "8a6e0f1c-1111-4222-8333-444455556666";
  const view = datasetEditorView({
    id, datasets: s.datasets, datasetsLoaded: s.loaded, datasetsError: s.error,
    sources: [], sourcesLoaded: true,
  });
  assert.equal(view.state, "error");
  assert.match(view.message, /Failed to fetch/);
  // Успешная загрузка без такого id — «не найден».
  dbImpl.getDatasets = async () => [];
  await useDatasetStore.getState().loadFromSupabase("u5");
  const ok = useDatasetStore.getState();
  assert.deepEqual(
    datasetEditorView({ id, datasets: ok.datasets, datasetsLoaded: ok.loaded, datasetsError: ok.error, sources: [], sourcesLoaded: true }),
    { state: "not_found" },
  );
});

test("Т08-1 «Campaign Performance Q2» в коде редактора нет", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(path.join(ROOT, "app/(app)/datasets/[id]/page.tsx"), "utf8");
  assert.ok(!src.includes("Campaign Performance Q2"));
});

// --- Перетест баера (fix/buyer-retest): 503 от Vercel — понятная ошибка, не «Unexpected token». ---
test("readApiJson: HTML-ответ 503 превращается в понятную ошибку", async () => {
  const { readApiJson } = require(path.join(ROOT, "lib/api-json.ts"));
  const r = await readApiJson(new Response("<html>Service Unavailable</html>", { status: 503 }));
  assert.match(r.error, /временно не ответил \(503\)/);
  const ok = await readApiJson(new Response(JSON.stringify({ data: [1] }), { status: 200 }));
  assert.deepEqual(ok, { data: [1] });
});

test("демо-CSV на сегодня: последний день файла — сегодняшняя дата по Москве", () => {
  const demo = require(path.join(ROOT, "lib/demo-data.ts"));
  const now = new Date("2026-11-15T09:00:00Z");
  const csv = demo.demoRowsToCsv(demo.generateDemoRows(now));
  const last = csv.trim().split("\n").pop().slice(0, 10);
  assert.equal(last, "2026-11-15");
  assert.equal(demo.DEMO_CSV_URL, "/api/demo-csv");
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
  console.log(`retest: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
