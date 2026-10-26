import type { CalculatedField, QueryResultRow } from "./types";

// ---------------------------------------------------------------------------
// Грамматика формул
// ---------------------------------------------------------------------------
// Поддерживаются:
//   - числа: 1, 1.5, 100
//   - имена столбцов в bare-нотации:    revenue
//   - имена столбцов в bracket-нотации: [revenue], [Доход USD], [arpu d7]
//   - арифметика: + - * /
//   - скобки: ( )
//   - унарный минус: -x
//   - агрегатные функции: SUM([x]), AVG([x]), COUNT([x]), COUNT(*), MIN([x]),
//     MAX([x]) (case-insensitive). Формула, содержащая хотя бы один
//     агрегат — «aggregate-level»: считается на уровне группы (день/кампания),
//     а не строки. Например: ДНЕВНОЙ CPA = SUM([cost]) / SUM([installs]).
//
// Bracket-нотация — рекомендуемая (введена в сессии 27): позволяет имена
// со спец-символами / пробелами / кириллицей. Bare-нотация сохранена
// для backward-совместимости со старыми вычисляемыми полями (формулы
// `revenue / spend * 100` из demo).

export type AggregateFn = "sum" | "avg" | "count" | "min" | "max";

const AGGREGATE_FNS: Record<string, AggregateFn> = {
  SUM: "sum",
  AVG: "avg",
  COUNT: "count",
  MIN: "min",
  MAX: "max",
};

export type FormulaNode =
  | { kind: "num"; value: number }
  | { kind: "ident"; name: string }
  | {
      kind: "bin";
      op: "+" | "-" | "*" | "/";
      left: FormulaNode;
      right: FormulaNode;
    }
  | { kind: "neg"; expr: FormulaNode }
  // `arg === null` — только для COUNT(*)
  | { kind: "agg"; fn: AggregateFn; arg: FormulaNode | null };

type Token =
  | { type: "num"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: "+" | "-" | "*" | "/" }
  | { type: "lparen" }
  | { type: "rparen" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    // Bracket-нотация: [имя столбца с любыми символами кроме `]`].
    if (ch === "[") {
      const end = input.indexOf("]", i + 1);
      if (end === -1) {
        throw new Error("Не найдена закрывающая скобка ] для имени столбца");
      }
      const name = input.slice(i + 1, end).trim();
      if (!name) {
        throw new Error("Пустое имя столбца в []");
      }
      tokens.push({ type: "ident", value: name });
      i = end + 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      const num = Number(input.slice(i, j));
      if (Number.isNaN(num)) {
        throw new Error(`Некорректное число: "${input.slice(i, j)}"`);
      }
      tokens.push({ type: "num", value: num });
      i = j;
      continue;
    }
    // Bare-ident: ASCII или кириллица + цифры/_.
    if (/[A-Za-z_\u0400-\u04FF]/.test(ch)) {
      let j = i + 1;
      while (j < input.length && /[A-Za-z0-9_\u0400-\u04FF]/.test(input[j])) j++;
      tokens.push({ type: "ident", value: input.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`Неизвестный символ "${ch}" в формуле`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  parse(): FormulaNode {
    const node = this.parseExpr();
    if (this.pos !== this.tokens.length) {
      throw new Error("Лишние символы в конце формулы");
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eat(): Token {
    const t = this.tokens[this.pos++];
    if (!t) throw new Error("Неожиданный конец формулы");
    return t;
  }

  private parseExpr(): FormulaNode {
    let left = this.parseTerm();
    while (true) {
      const t = this.peek();
      if (!t || t.type !== "op" || (t.value !== "+" && t.value !== "-")) break;
      this.eat();
      const right = this.parseTerm();
      left = { kind: "bin", op: t.value, left, right };
    }
    return left;
  }

  private parseTerm(): FormulaNode {
    let left = this.parseFactor();
    while (true) {
      const t = this.peek();
      if (!t || t.type !== "op" || (t.value !== "*" && t.value !== "/")) break;
      this.eat();
      const right = this.parseFactor();
      left = { kind: "bin", op: t.value, left, right };
    }
    return left;
  }

  private parseFactor(): FormulaNode {
    const t = this.peek();
    if (!t) throw new Error("Неожиданный конец формулы");

    if (t.type === "op" && t.value === "-") {
      this.eat();
      return { kind: "neg", expr: this.parseFactor() };
    }
    if (t.type === "op" && t.value === "+") {
      this.eat();
      return this.parseFactor();
    }
    if (t.type === "num") {
      this.eat();
      return { kind: "num", value: t.value };
    }
    if (t.type === "ident") {
      // Идентификатор, за которым сразу идёт `(` — это вызов функции.
      const next = this.tokens[this.pos + 1];
      if (next && next.type === "lparen") {
        return this.parseFunctionCall(t.value);
      }
      this.eat();
      return { kind: "ident", name: t.value };
    }
    if (t.type === "lparen") {
      this.eat();
      const expr = this.parseExpr();
      const close = this.peek();
      if (!close || close.type !== "rparen") {
        throw new Error("Ожидалась закрывающая скобка )");
      }
      this.eat();
      return expr;
    }
    throw new Error("Неожиданный токен в формуле");
  }

  private parseFunctionCall(rawName: string): FormulaNode {
    const fn = AGGREGATE_FNS[rawName.toUpperCase()];
    if (!fn) {
      throw new Error(
        `Неизвестная функция "${rawName}(…)". Доступны: SUM, AVG, COUNT, MIN, MAX`,
      );
    }
    this.eat(); // ident
    this.eat(); // lparen
    // COUNT(*) — спец-случай: считаем количество строк в группе.
    const after = this.peek();
    if (fn === "count" && after && after.type === "op" && after.value === "*") {
      this.eat(); // '*'
      const close = this.peek();
      if (!close || close.type !== "rparen") {
        throw new Error("Ожидалась закрывающая скобка ) после COUNT(*)");
      }
      this.eat();
      return { kind: "agg", fn: "count", arg: null };
    }
    const arg = this.parseExpr();
    const close = this.peek();
    if (!close || close.type !== "rparen") {
      throw new Error(`Ожидалась закрывающая скобка ) для ${rawName}(…)`);
    }
    this.eat();
    return { kind: "agg", fn, arg };
  }
}

export function parseFormula(formula: string): FormulaNode {
  const trimmed = formula.trim();
  if (!trimmed) throw new Error("Формула пустая");
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) throw new Error("Формула пустая");
  return new Parser(tokens).parse();
}

export function collectIdentifiers(node: FormulaNode): string[] {
  const set = new Set<string>();
  const walk = (n: FormulaNode) => {
    if (n.kind === "ident") set.add(n.name);
    else if (n.kind === "bin") {
      walk(n.left);
      walk(n.right);
    } else if (n.kind === "neg") {
      walk(n.expr);
    } else if (n.kind === "agg") {
      if (n.arg) walk(n.arg);
    }
  };
  walk(node);
  return Array.from(set);
}

/** Содержит ли AST хотя бы один агрегатный вызов на любом уровне. */
export function formulaHasAggregate(node: FormulaNode): boolean {
  let found = false;
  const walk = (n: FormulaNode) => {
    if (found) return;
    if (n.kind === "agg") {
      found = true;
      return;
    }
    if (n.kind === "bin") {
      walk(n.left);
      walk(n.right);
    } else if (n.kind === "neg") {
      walk(n.expr);
    }
  };
  walk(node);
  return found;
}

// ---------------------------------------------------------------------------
// Семантика aggregate-level формул
// ---------------------------------------------------------------------------

export interface AggregateAnalysis {
  /**
   * `true`, если формула является aggregate-level: содержит SUM/AVG/COUNT/
   * MIN/MAX напрямую ИЛИ ссылается на другое aggregate-вычисляемое поле
   * (правило транзитивности).
   */
  isAggregate: boolean;
  /** Поле стало aggregate ТОЛЬКО из-за ссылки на агрегатное поле (без явных SUM/…). */
  inheritedAggregate: boolean;
  /** Имена aggregate-полей, на которые ссылается формула (для текста предупреждения). */
  aggregateRefs: string[];
  /** Текст ошибки (микс уровней / вложенные агрегаты), если формула невалидна. */
  error?: string;
}

/**
 * Анализирует формулу на корректность aggregate-уровня:
 *  - запрещены вложенные агрегаты (`SUM(AVG([x]))`) и `SUM([agg_field])`;
 *  - запрещён микс — если в формуле есть агрегат, то ВСЕ упоминания
 *    столбцов должны быть либо внутри агрегата, либо ссылками на другие
 *    aggregate-поля (`SUM([cost]) / [CPA]` ок; `SUM([cost]) / [installs]` нет).
 *
 * `isAggregateRef(name)` — функция: является ли вычисляемое поле с таким
 * именем aggregate-level. Для сырых столбцов всегда `false`.
 */
export function analyzeAggregateUsage(
  node: FormulaNode,
  isAggregateRef: (name: string) => boolean,
): AggregateAnalysis {
  const aggregateRefsSet = new Set<string>();
  const collectAggRefs = (n: FormulaNode) => {
    if (n.kind === "ident") {
      if (isAggregateRef(n.name)) aggregateRefsSet.add(n.name);
    } else if (n.kind === "bin") {
      collectAggRefs(n.left);
      collectAggRefs(n.right);
    } else if (n.kind === "neg") {
      collectAggRefs(n.expr);
    } else if (n.kind === "agg") {
      if (n.arg) collectAggRefs(n.arg);
    }
  };
  collectAggRefs(node);

  const hasOwnAgg = formulaHasAggregate(node);
  const isAggregate = hasOwnAgg || aggregateRefsSet.size > 0;
  const inheritedAggregate = !hasOwnAgg && aggregateRefsSet.size > 0;

  if (!isAggregate) {
    return { isAggregate: false, inheritedAggregate: false, aggregateRefs: [] };
  }

  // Вложенность: внутри agg.arg не должно быть других агрегатов и ссылок
  // на aggregate-поля (после инлайна ссылок они станут вложенными агрегатами).
  let nestError = false;
  const checkNesting = (n: FormulaNode, insideAgg: boolean) => {
    if (n.kind === "agg") {
      if (insideAgg) {
        nestError = true;
        return;
      }
      if (n.arg) checkNesting(n.arg, true);
    } else if (n.kind === "ident") {
      if (insideAgg && isAggregateRef(n.name)) nestError = true;
    } else if (n.kind === "bin") {
      checkNesting(n.left, insideAgg);
      checkNesting(n.right, insideAgg);
    } else if (n.kind === "neg") {
      checkNesting(n.expr, insideAgg);
    }
  };
  checkNesting(node, false);
  if (nestError) {
    return {
      isAggregate,
      inheritedAggregate,
      aggregateRefs: Array.from(aggregateRefsSet),
      error: "Вложенные агрегатные функции не поддерживаются.",
    };
  }

  // Микс: сырой столбец вне агрегата при наличии агрегата в формуле.
  let mixError = false;
  const checkMix = (n: FormulaNode, insideAgg: boolean) => {
    if (n.kind === "ident") {
      if (!insideAgg && !isAggregateRef(n.name)) mixError = true;
    } else if (n.kind === "agg") {
      if (n.arg) checkMix(n.arg, true);
    } else if (n.kind === "bin") {
      checkMix(n.left, insideAgg);
      checkMix(n.right, insideAgg);
    } else if (n.kind === "neg") {
      checkMix(n.expr, insideAgg);
    }
  };
  checkMix(node, false);
  if (mixError) {
    return {
      isAggregate,
      inheritedAggregate,
      aggregateRefs: Array.from(aggregateRefsSet),
      error:
        "В одной формуле либо все колонки в SUM/AVG/COUNT/MIN/MAX, либо ни одной. Нельзя смешивать.",
    };
  }

  return {
    isAggregate,
    inheritedAggregate,
    aggregateRefs: Array.from(aggregateRefsSet),
  };
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  ast?: FormulaNode;
  identifiers?: string[];
  unknown?: string[];
  /** Является ли формула aggregate-level (заполняется только при `ok`). */
  isAggregate?: boolean;
  /** Стала aggregate только из-за ссылки на агрегатное поле. */
  inheritedAggregate?: boolean;
  /** Имена aggregate-полей, на которые ссылается формула. */
  aggregateRefs?: string[];
}

/**
 * Проверяет, что формула парсится, все упомянутые идентификаторы
 * существуют (как столбцы датасета либо другие вычисляемые поля), и
 * корректно используются агрегатные функции (без микса уровней и
 * вложенности).
 *
 * `availableColumns` должен включать имена и сырых столбцов, и других
 * вычисляемых полей. `isAggregateRef` (опционально) — функция, говорящая,
 * является ли вычисляемое поле с данным именем aggregate-level; нужна
 * для проверки транзитивности и микса. По умолчанию — все ссылки
 * считаются не-агрегатными (поведение совместимо с прежним кодом).
 */
export function validateFormula(
  formula: string,
  availableColumns: string[],
  isAggregateRef: (name: string) => boolean = () => false,
): ValidationResult {
  try {
    const ast = parseFormula(formula);
    const ids = collectIdentifiers(ast);
    const available = new Set(availableColumns);
    const unknown = ids.filter((id) => !available.has(id));
    if (unknown.length > 0) {
      return {
        ok: false,
        error: `Неизвестные столбцы: ${unknown.join(", ")}`,
        unknown,
      };
    }
    const agg = analyzeAggregateUsage(ast, isAggregateRef);
    if (agg.error) {
      return { ok: false, error: agg.error, ast, identifiers: ids };
    }
    return {
      ok: true,
      ast,
      identifiers: ids,
      isAggregate: agg.isAggregate,
      inheritedAggregate: agg.inheritedAggregate,
      aggregateRefs: agg.aggregateRefs,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Эвалюатор для **строки** (row-level). Если формула содержит агрегат
 * (`agg`-узел) — возвращает `null`: агрегаты не имеют смысла без контекста
 * группы (см. `evaluateAggregateFormula`).
 */
export function evaluateFormula(
  node: FormulaNode,
  row: QueryResultRow,
): number | null {
  const walk = (n: FormulaNode): number | null => {
    if (n.kind === "num") return n.value;
    if (n.kind === "ident") {
      const v = row[n.name];
      if (v === null || v === undefined) return null;
      const num = typeof v === "number" ? v : Number(v);
      if (Number.isNaN(num)) return null;
      return num;
    }
    if (n.kind === "neg") {
      const inner = walk(n.expr);
      return inner === null ? null : -inner;
    }
    if (n.kind === "agg") {
      // Агрегат на уровне строки не определён.
      return null;
    }
    const l = walk(n.left);
    const r = walk(n.right);
    if (l === null || r === null) return null;
    switch (n.op) {
      case "+":
        return l + r;
      case "-":
        return l - r;
      case "*":
        return l * r;
      case "/":
        if (r === 0) return null;
        return l / r;
    }
  };
  const result = walk(node);
  if (result === null || Number.isNaN(result) || !Number.isFinite(result)) {
    return null;
  }
  return result;
}

/** Применяет агрегатную функцию к набору значений (null/NaN/Inf отбрасываются). */
export function applyAggregate(
  fn: AggregateFn,
  values: Array<number | null>,
): number | null {
  if (fn === "count") {
    // count([x]) — количество не-null значений (count(*) обрабатывается
    // отдельно в evaluateAggregateFormula по длине группы).
    return values.filter((v) => v !== null && Number.isFinite(v)).length;
  }
  const nums = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  if (nums.length === 0) {
    // sum пустого набора = 0 (как ClickHouse); avg/min/max = null.
    return fn === "sum" ? 0 : null;
  }
  switch (fn) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "avg":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
  }
}

/**
 * Эвалюатор aggregate-level формулы для одной **группы** строк. AST должен
 * быть с уже разрешёнными ссылками на вычисляемые поля (см. `resolveCalcRefs`),
 * то есть содержать только сырые столбцы, константы, арифметику и `agg`-узлы.
 */
export function evaluateAggregateFormula(
  node: FormulaNode,
  groupRows: QueryResultRow[],
): number | null {
  const walk = (n: FormulaNode): number | null => {
    if (n.kind === "num") return n.value;
    if (n.kind === "ident") {
      // Сырой столбец вне агрегата в aggregate-формуле — некорректно
      // (микс уровней; UI это блокирует). Возвращаем null.
      return null;
    }
    if (n.kind === "neg") {
      const inner = walk(n.expr);
      return inner === null ? null : -inner;
    }
    if (n.kind === "agg") {
      if (n.fn === "count" && n.arg === null) {
        return groupRows.length;
      }
      const arg = n.arg!;
      return applyAggregate(
        n.fn,
        groupRows.map((r) => evaluateFormula(arg, r)),
      );
    }
    const l = walk(n.left);
    const r = walk(n.right);
    if (l === null || r === null) return null;
    switch (n.op) {
      case "+":
        return l + r;
      case "-":
        return l - r;
      case "*":
        return l * r;
      case "/":
        if (r === 0) return null;
        return l / r;
    }
  };
  const result = walk(node);
  if (result === null || Number.isNaN(result) || !Number.isFinite(result)) {
    return null;
  }
  return result;
}

/**
 * Генерирует SQL-выражение из AST. Верхний уровень оборачивается в
 * `if(isFinite(<expr>), <expr>, NULL)` — любая «математическая патология»
 * по ходу вычисления (деление на ноль → `inf`/`nan`, `log(0)`, `sqrt(-1)`
 * и т.п.) превращается в `NULL`, который агрегаты (`sum`/`avg`/…) затем
 * игнорируют. Без этого ClickHouse возвращает `inf`/`nan`, которые в
 * `FORMAT JSON` сериализуются как `null` и в таблице видны как «—».
 *
 * Агрегатные узлы превращаются в нативные ClickHouse-агрегаты:
 *   SUM([x]) → sum(x), COUNT(*) → count(*), AVG([x]) → avg(x), и т.д.
 *
 * Поведение demo-режима (`evaluateFormula` / `evaluateAggregateFormula`) уже
 * корректно — там деление на ноль даёт `null`; эту функцию правка не затрагивает.
 */
export function formulaToSql(
  node: FormulaNode,
  quoteIdent: (s: string) => string,
): string {
  const walk = (n: FormulaNode): string => {
    if (n.kind === "num") return String(n.value);
    if (n.kind === "ident") return quoteIdent(n.name);
    if (n.kind === "neg") return `(-${walk(n.expr)})`;
    if (n.kind === "agg") {
      if (n.fn === "count" && n.arg === null) return "count(*)";
      return `${n.fn}(${walk(n.arg!)})`;
    }
    return `(${walk(n.left)} ${n.op} ${walk(n.right)})`;
  };
  const expr = walk(node);
  return `if(isFinite(${expr}), ${expr}, NULL)`;
}

// ---------------------------------------------------------------------------
// Сессия 27 — ссылки calc-on-calc
// ---------------------------------------------------------------------------
// Вычисляемое поле может ссылаться на ДРУГОЕ вычисляемое поле:
//   ARPU       = [revenue] / [installs]
//   ARPU_x100  = [arpu] * 100
// Чтобы такие формулы работали:
//   - в demo-режиме: эвалим поля в порядке зависимостей, передавая
//     уже обогащённую row следующим полям (см. enrichRowsWithCalculated);
//   - в SQL-режиме: рекурсивно подставляем AST зависимого поля
//     (см. resolveCalcRefs) и квалифицируем уже окончательным
//     `formulaToSql`.

export interface PreparedField {
  field: CalculatedField;
  ast: FormulaNode;
  /** Имена идентификаторов, на которые ссылается формула. */
  refs: string[];
}

/**
 * Парсит и валидирует список calc-полей. Невалидные пропускаются —
 * вызывающий код может проверить `valid.length === fields.length`.
 */
export function prepareCalculatedFields(
  fields: CalculatedField[],
): PreparedField[] {
  const out: PreparedField[] = [];
  for (const f of fields) {
    try {
      const ast = parseFormula(f.formula);
      out.push({ field: f, ast, refs: collectIdentifiers(ast) });
    } catch {
      // ignore — UI отдельно не даёт сохранить невалидное
    }
  }
  return out;
}

/**
 * Вычисляет для каждого поля флаг «aggregate-level» с учётом транзитивности
 * (поле, ссылающееся на aggregate-поле, тоже aggregate). Циклы → `false`
 * (такие поля и так не работают).
 */
export function computeAggregateFlags(
  prepared: PreparedField[],
): Map<string, boolean> {
  const byName = new Map(prepared.map((p) => [p.field.name, p]));
  const cache = new Map<string, boolean>();
  const visiting = new Set<string>();
  const resolve = (name: string): boolean => {
    if (cache.has(name)) return cache.get(name)!;
    const p = byName.get(name);
    if (!p) return false; // сырой столбец
    if (visiting.has(name)) return false; // цикл
    visiting.add(name);
    let agg = formulaHasAggregate(p.ast);
    if (!agg) {
      for (const r of p.refs) {
        if (resolve(r)) {
          agg = true;
          break;
        }
      }
    }
    visiting.delete(name);
    cache.set(name, agg);
    return agg;
  };
  for (const p of prepared) resolve(p.field.name);
  return cache;
}

/**
 * Топологическая сортировка вычисляемых полей по зависимостям между ними.
 * Поля, ссылки которых указывают только на сырые столбцы или ни на что
 * (числа), идут первыми. Поле B со ссылкой `[arpu]` идёт после поля A
 * с именем `arpu`.
 *
 * Циклы намеренно НЕ блокируют — циклически зависимые поля просто
 * остаются в конце и при эвалюации возвращают null.
 */
export function topoSortCalculatedFields(
  prepared: PreparedField[],
): PreparedField[] {
  const byName = new Map(prepared.map((p) => [p.field.name, p]));
  const visited = new Set<string>();
  const inProgress = new Set<string>();
  const result: PreparedField[] = [];

  const visit = (p: PreparedField) => {
    if (visited.has(p.field.name)) return;
    if (inProgress.has(p.field.name)) return; // cycle — bail
    inProgress.add(p.field.name);
    for (const r of p.refs) {
      const dep = byName.get(r);
      if (dep) visit(dep);
    }
    inProgress.delete(p.field.name);
    visited.add(p.field.name);
    result.push(p);
  };

  for (const p of prepared) visit(p);
  return result;
}

/**
 * Применяет упорядоченные **row-level** вычисляемые поля к каждой строке.
 * Поле, ссылающееся на другое поле, видит его уже вычисленным.
 *
 * Aggregate-level поля сюда передавать НЕ нужно — для них контекст строки
 * не определён (`evaluateFormula` вернёт `null`). Их считают на уровне
 * группы (см. `lib/aggregation.ts`).
 */
export function enrichRowsWithCalculated(
  rows: QueryResultRow[],
  ordered: PreparedField[],
): QueryResultRow[] {
  if (ordered.length === 0) return rows;
  return rows.map((row) => {
    const next: QueryResultRow = { ...row };
    for (const { field, ast } of ordered) {
      const v = evaluateFormula(ast, next);
      if (v === null) {
        next[field.name] = null;
      } else {
        next[field.name] =
          field.datasetType === "integer" ? Math.trunc(v) : v;
      }
    }
    return next;
  });
}

/**
 * Рекурсивно подставляет в AST ссылки на вычисляемые поля их собственными
 * AST. Полученный AST содержит только имена сырых столбцов, константы и
 * `agg`-узлы — безопасно скармливать `formulaToSql` / `evaluateAggregateFormula`.
 *
 * Циклы прерываются: ident оставляется как есть (формирует
 * несуществующий SQL-столбец → ClickHouse вернёт ошибку, но не
 * вечный цикл).
 */
export function resolveCalcRefs(
  ast: FormulaNode,
  prepared: Map<string, PreparedField>,
  inProgress: Set<string> = new Set(),
): FormulaNode {
  const walk = (n: FormulaNode): FormulaNode => {
    if (n.kind === "ident") {
      const dep = prepared.get(n.name);
      if (!dep || inProgress.has(n.name)) return n;
      const next = new Set(inProgress);
      next.add(n.name);
      return resolveCalcRefs(dep.ast, prepared, next);
    }
    if (n.kind === "bin") {
      return { kind: "bin", op: n.op, left: walk(n.left), right: walk(n.right) };
    }
    if (n.kind === "neg") {
      return { kind: "neg", expr: walk(n.expr) };
    }
    if (n.kind === "agg") {
      return { kind: "agg", fn: n.fn, arg: n.arg ? walk(n.arg) : null };
    }
    return n;
  };
  return walk(ast);
}

/**
 * «Понижает» aggregate-формулу до row-level: убирает агрегатные функции,
 * оставляя их внутреннее выражение. Используется ТОЛЬКО для превью датасета
 * (плоская таблица без группировки), чтобы пользователь видел «что внутри»:
 *   SUM([a] + [b])        → [a] + [b]
 *   AVG([revenue])        → [revenue]
 *   SUM([cost]) / SUM([t])→ [cost] / [t]
 *   COUNT([x]) / COUNT(*) → 1   (в превью не считаем уникальность/строки)
 *
 * Не используется в визуализациях — там агрегаты считаются полноценно
 * на уровне группы (`evaluateAggregateFormula` / `formulaToSql`).
 */
export function stripAggregates(node: FormulaNode): FormulaNode {
  const walk = (n: FormulaNode): FormulaNode => {
    if (n.kind === "agg") {
      if (n.fn === "count") return { kind: "num", value: 1 };
      // sum / avg / min / max → внутреннее выражение (рекурсивно — на случай
      // вложенных агрегатов, хотя валидация их запрещает).
      return walk(n.arg ?? { kind: "num", value: 1 });
    }
    if (n.kind === "bin") {
      return { kind: "bin", op: n.op, left: walk(n.left), right: walk(n.right) };
    }
    if (n.kind === "neg") {
      return { kind: "neg", expr: walk(n.expr) };
    }
    return n;
  };
  return walk(node);
}

/**
 * «Поднимает» row-level формулу до aggregate-level: оборачивает каждую ссылку на
 * сырой столбец в `SUM(...)`. Нужно, когда ПОСТРОЧНОЕ вычисляемое поле выбрано
 * как МЕТРИКА сводной: тогда оно считается ПО ФОРМУЛЕ из СУММ баз по группе
 * (доля = `SUM(a)/SUM(b)`, как в сводных таблицах), а не суммой построчных
 * значений (`SUM(a/b)` — бессмыслица для долей). Для аддитивных формул
 * (`[a]-[b]`) результат совпадает с прежним SUM. AST должен быть уже без ссылок
 * на calc-поля (после `resolveCalcRefs`) — тогда `ident` это всегда сырой
 * столбец. Узлы-агрегаты не трогаем (если формула частично агрегатная).
 */
export function liftRowLevelToAggregate(node: FormulaNode): FormulaNode {
  const walk = (n: FormulaNode): FormulaNode => {
    if (n.kind === "ident") return { kind: "agg", fn: "sum", arg: n };
    if (n.kind === "bin") {
      return { kind: "bin", op: n.op, left: walk(n.left), right: walk(n.right) };
    }
    if (n.kind === "neg") return { kind: "neg", expr: walk(n.expr) };
    // num / agg — оставляем как есть
    return n;
  };
  return walk(node);
}
