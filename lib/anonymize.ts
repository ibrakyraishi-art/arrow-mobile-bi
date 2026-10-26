import "server-only";
import type { QueryResultRow } from "./types";

/**
 * Обратимая токенизация конфиденциальных значений (режим NDA для AI-анализа).
 *
 * Идея: реальное значение («Nike Summer») ↔ код («CAMP_01»). В Claude уходят
 * ТОЛЬКО коды; обратная замена (код → реальное имя) делается на сервере перед
 * отдачей пользователю. Это НЕ хэш — замена обратима по словарю, который живёт
 * только на сервере (зашифрованным, под RLS).
 *
 * Этот модуль — чистая логика без доступа к БД (загрузку/сохранение словаря
 * делает вызывающий код). `server-only` гарантирует, что в браузер не попадёт.
 */

/** Состояние словаря одного столбца. */
interface ColumnState {
  /** Стабильный префикс кода для столбца, напр. "SRC". Только буквы A-Z. */
  prefix: string;
  /** Реальное значение (trim) → код. Append-only: коды не переназначаются. */
  values: Record<string, string>;
  /** Следующий порядковый номер кода. */
  next: number;
}

/** Полное состояние словаря проекта (то, что шифруется и хранится в БД). */
export interface AnonState {
  version: 1;
  /** Имя столбца → его словарь. */
  columns: Record<string, ColumnState>;
}

export function emptyAnonState(): AnonState {
  return { version: 1, columns: {} };
}

/** Безопасно распарсить расшифрованный словарь; при любой проблеме — пустой. */
export function parseAnonState(json: string | null | undefined): AnonState {
  if (!json) return emptyAnonState();
  try {
    const parsed = JSON.parse(json) as Partial<AnonState>;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.columns &&
      typeof parsed.columns === "object"
    ) {
      return { version: 1, columns: parsed.columns as AnonState["columns"] };
    }
  } catch {
    // битый/несовместимый словарь — начинаем с чистого (старые коды потеряются,
    // но утечки не будет; это безопасный фоллбэк).
  }
  return emptyAnonState();
}

// ---------------------------------------------------------------------------
// Префиксы кодов по столбцам
// ---------------------------------------------------------------------------

/** Узнаваемые префиксы для типовых медиабаинговых столбцов. */
const KNOWN_PREFIXES: { test: RegExp; prefix: string }[] = [
  { test: /(utm_)?source|src\b/i, prefix: "SRC" },
  { test: /(utm_)?campaign|camp\b/i, prefix: "CAMP" },
  { test: /creative|banner|\bad\b|advert/i, prefix: "CRT" },
  { test: /adset|ad_set|adgroup|ad_group/i, prefix: "ADS" },
  { test: /geo|country|region|city|\bgeo_/i, prefix: "GEO" },
  { test: /placement|\bplace/i, prefix: "PLC" },
  { test: /app|application|bundle|package/i, prefix: "APP" },
  { test: /offer/i, prefix: "OFR" },
  { test: /publisher|\bpub\b/i, prefix: "PUB" },
  { test: /channel/i, prefix: "CHN" },
  { test: /partner|affiliate/i, prefix: "PRT" },
  { test: /keyword|\bkw\b/i, prefix: "KW" },
];

/** Базовый префикс из имени столбца (только буквы A-Z, длина ≥2). */
function basePrefix(column: string): string {
  for (const k of KNOWN_PREFIXES) {
    if (k.test.test(column)) return k.prefix;
  }
  // Берём первый «словесный» токен, оставляем только латинские буквы.
  const token = column.split(/[^A-Za-z]+/).find((t) => t.length > 0) ?? "";
  const letters = token.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (letters.length >= 2) return letters.slice(0, 4);
  // Фоллбэк для не-латинских/коротких имён.
  return "COL";
}

/**
 * Подбирает уникальные префиксы для набора конфиденциальных столбцов.
 * Уникальность критична: коды должны быть глобально однозначными для обратной
 * замены (иначе SRC_01 из двух столбцов = неоднозначность). При коллизии
 * дописываем букву (только A-Z, чтобы код оставался вида `[A-Z]+_\d+`).
 */
function assignPrefixes(
  state: AnonState,
  columns: string[],
): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();
  // Уже назначенные ранее префиксы фиксируем (стабильность кодов).
  for (const [col, cs] of Object.entries(state.columns)) {
    if (cs.prefix) {
      used.add(cs.prefix);
      if (columns.includes(col)) result.set(col, cs.prefix);
    }
  }
  for (const col of columns) {
    if (result.has(col)) continue;
    let prefix = basePrefix(col);
    if (used.has(prefix)) {
      // Дописываем буквы B, C, … пока не станет уникальным.
      let i = 0;
      let candidate = prefix;
      while (used.has(candidate)) {
        const suffix = String.fromCharCode(66 + (i % 25)); // 'B'..'Z'
        candidate = `${prefix}${suffix}`;
        i += 1;
        if (i > 50) {
          candidate = `${prefix}${Date.now().toString(36).toUpperCase().replace(/[^A-Z]/g, "")}`;
          break;
        }
      }
      prefix = candidate;
    }
    used.add(prefix);
    result.set(col, prefix);
  }
  return result;
}

function formatCode(prefix: string, index: number): string {
  return `${prefix}_${String(index).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Построение / расширение словаря
// ---------------------------------------------------------------------------

/** Нормализация ключа значения: trim. Регистр НЕ трогаем (однозначность). */
function normValue(v: string | number | null): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Дополняет словарь новыми значениями из строк по конфиденциальным столбцам.
 * Append-only: существующие коды сохраняются. Возвращает новое состояние и
 * флаг, изменилось ли оно (чтобы не писать в БД зря).
 */
export function extendAnonState(
  state: AnonState,
  rows: QueryResultRow[],
  confidentialColumns: string[],
): { state: AnonState; changed: boolean } {
  const cols = confidentialColumns.filter((c) => typeof c === "string" && c);
  if (cols.length === 0) return { state, changed: false };

  const prefixes = assignPrefixes(state, cols);
  // Глубокая, но дешёвая копия структуры словаря.
  const next: AnonState = {
    version: 1,
    columns: Object.fromEntries(
      Object.entries(state.columns).map(([k, v]) => [
        k,
        { prefix: v.prefix, values: { ...v.values }, next: v.next },
      ]),
    ),
  };
  let changed = false;

  for (const col of cols) {
    const prefix = prefixes.get(col) ?? "COL";
    if (!next.columns[col]) {
      next.columns[col] = { prefix, values: {}, next: 1 };
      changed = true;
    } else if (next.columns[col].prefix !== prefix) {
      next.columns[col].prefix = prefix;
      changed = true;
    }
    const cs = next.columns[col];
    for (const row of rows) {
      const key = normValue(row[col]);
      if (key === null) continue;
      if (!(key in cs.values)) {
        cs.values[key] = formatCode(cs.prefix, cs.next);
        cs.next += 1;
        changed = true;
      }
    }
  }

  return { state: next, changed };
}

// ---------------------------------------------------------------------------
// Производные структуры
// ---------------------------------------------------------------------------

/** Код → реальное значение (для обратной замены). */
export function buildReverseMap(state: AnonState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const cs of Object.values(state.columns)) {
    for (const [real, code] of Object.entries(cs.values)) {
      out[code] = real;
    }
  }
  return out;
}

/**
 * Пары [реальноеЗначение, код] для маскировки свободного текста.
 * Отсортированы по длине значения по убыванию (длинные подменяем первыми).
 */
export function buildValuePairs(state: AnonState): [string, string][] {
  const seen = new Set<string>();
  const pairs: [string, string][] = [];
  for (const cs of Object.values(state.columns)) {
    for (const [real, code] of Object.entries(cs.values)) {
      if (seen.has(real)) continue;
      seen.add(real);
      pairs.push([real, code]);
    }
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  return pairs;
}

// ---------------------------------------------------------------------------
// Маскировка
// ---------------------------------------------------------------------------

/**
 * Маскирует ячейки конфиденциальных столбцов в строках (точное совпадение по
 * значению ячейки, НЕ по подстроке). Возвращает НОВЫЙ массив; исходные строки
 * не мутируются. Числовые/прочие столбцы не трогаются.
 */
export function maskRows(
  rows: QueryResultRow[],
  confidentialColumns: string[],
  state: AnonState,
): QueryResultRow[] {
  const cols = confidentialColumns.filter((c) => state.columns[c]);
  if (cols.length === 0) return rows;
  return rows.map((row) => {
    const out: QueryResultRow = { ...row };
    for (const col of cols) {
      const key = normValue(row[col]);
      if (key === null) continue;
      const code = state.columns[col].values[key];
      if (code) out[col] = code;
    }
    return out;
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Маскирует реальные значения в свободном тексте (prompt, businessContext,
 * описания столбцов, доп. контекст, лейблы воронки) — заменяет встреченные
 * реальные имена на коды. Сопоставление по границам слов (не ломает подстроки
 * внутри других слов), спецсимволы экранируются, длинные значения — первыми.
 */
export function maskText(
  text: string | null | undefined,
  pairs: [string, string][],
): string {
  if (!text) return text ?? "";
  if (pairs.length === 0) return text;
  const valueToCode = new Map(pairs);
  const alternation = pairs.map(([v]) => escapeRegExp(v)).join("|");
  if (!alternation) return text;
  // Границы: значение не должно быть частью большего слова/числа.
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${alternation})(?![\\p{L}\\p{N}_])`,
    "gu",
  );
  return text.replace(re, (m) => valueToCode.get(m) ?? m);
}

/** Сериализация строк в CSV (та же логика экранирования, что на клиенте). */
export function rowsToCsv(rows: QueryResultRow[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  if (keys.length === 0) return ""; // строки без полей (все колонки исключены)
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n;\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = keys.join(",");
  const body = rows.map((r) => keys.map((k) => esc(r[k])).join(",")).join("\n");
  return `${header}\n${body}`;
}

// ---------------------------------------------------------------------------
// Обратная замена в SSE-стриме (самая хрупкая часть)
// ---------------------------------------------------------------------------

/**
 * Буферизованная замена код → реальное имя в потоке. Claude отдаёт текст
 * кусками, и код (SRC_07) может разорваться между чанками. Поэтому держим
 * «хвост», который потенциально является началом кода, и отдаём только
 * гарантированно завершённый текст.
 *
 * Код имеет вид `[A-Z]{2,}_\d+`. Потенциальный незавершённый код в конце —
 * любой замыкающий ран из [A-Z0-9_], начинающийся с заглавной буквы (даже
 * одна буква «S» может оказаться началом «SRC_07»). Такой хвост придерживаем
 * до следующего чанка/флэша.
 */
/**
 * Нормализует код для устойчивого матчинга: верхний регистр + номер без ведущих
 * нулей. `CRT_01`, `crt_01`, `Crt_1` → все дают `CRT_1`. Нормализация инъективна
 * для кодов вида `PREFIX_index` (префиксы — только буквы, индексы 1..N), поэтому
 * два разных кода не схлопываются в один.
 */
function normalizeCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/_(\d+)$/, (_m, n: string) => `_${parseInt(n, 10)}`);
}

export function createReverseReplacer(reverseMap: Record<string, string>): {
  push: (delta: string) => string;
  flush: () => string;
} {
  // Нормализованная карта: код (верхний регистр, номер без ведущих нулей) →
  // реальное значение. Делает обратную замену устойчивой к тому, что LLM
  // возвращает код не дословно (регистр / потерянный ведущий ноль).
  const normMap: Record<string, string> = {};
  for (const [code, real] of Object.entries(reverseMap)) {
    normMap[normalizeCode(code)] = real;
  }

  let pending = "";
  // Полный код: 2+ буквы, '_', цифры — РЕГИСТРОНЕЗАВИСИМО.
  const codeRe = /[A-Za-z]{2,}_\d+/g;
  // Возможный незавершённый код в конце чанка: либо «буквы_цифры?» (есть '_'),
  // либо ран ЗАГЛАВНЫХ букв (начало кода) — даже одна «S» может оказаться
  // началом «SRC_07», если чанк оборвался сразу после первой буквы. Обычные
  // строчные слова без '_' не придерживаем — чтобы не тормозить обычный текст.
  const tailRe = /(?:[A-Za-z]{2,}_\d*|[A-Z]+)$/;

  // Заменяем ТОЛЬКО если нормализованный код есть в карте → без ложных
  // срабатываний на реальных (немаскированных) значениях вида «AB_12».
  const replaceCodes = (s: string): string =>
    s.replace(codeRe, (m) => normMap[normalizeCode(m)] ?? m);

  return {
    push(delta: string): string {
      if (!delta) return "";
      pending += delta;
      const m = tailRe.exec(pending);
      // Точка, до которой текст безопасно отдавать (не режем код).
      const safeEnd = m ? m.index : pending.length;
      const safe = pending.slice(0, safeEnd);
      pending = pending.slice(safeEnd);
      return replaceCodes(safe);
    },
    flush(): string {
      const out = replaceCodes(pending);
      pending = "";
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Кардинальность (для предупреждения в UI)
// ---------------------------------------------------------------------------

/** Количество уникальных непустых значений в столбце (по строкам). */
export function distinctCount(
  rows: QueryResultRow[],
  column: string,
): number {
  const set = new Set<string>();
  for (const row of rows) {
    const key = normValue(row[column]);
    if (key !== null) set.add(key);
  }
  return set.size;
}

/** Порог «высокой кардинальности» для мягкого предупреждения. */
export const HIGH_CARDINALITY_THRESHOLD = 300;
