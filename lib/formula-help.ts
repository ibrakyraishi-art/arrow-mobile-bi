import {
  parseFormula,
  validateFormula,
  type FormulaNode,
} from "./formula";

/**
 * Человеко-понятное объяснение ошибки формулы вычисляемого поля + (если можно)
 * автоматическое исправление. Чисто UI-слой над `validateFormula` — на движок
 * и саму валидацию не влияет.
 */
export interface FormulaHelp {
  /** Понятный текст: что не так и как починить. */
  message: string;
  /** Готовая исправленная формула (если автофикс однозначен). Иначе undefined. */
  fix?: string;
  /** Короткая подпись на кнопке автофикса. */
  fixLabel?: string;
}

const AGG_NAMES = ["SUM", "AVG", "COUNT", "MIN", "MAX"];

/** Имена агрегат-полей, обёрнутых в агрегат: `SUM([installs])`. */
function aggregatedAggRefs(
  ast: FormulaNode,
  isAggregateRef: (n: string) => boolean,
): string[] {
  const out = new Set<string>();
  const walk = (n: FormulaNode, insideAgg: boolean) => {
    if (n.kind === "agg") {
      if (n.arg) walk(n.arg, true);
    } else if (n.kind === "ident") {
      if (insideAgg && isAggregateRef(n.name)) out.add(n.name);
    } else if (n.kind === "bin") {
      walk(n.left, insideAgg);
      walk(n.right, insideAgg);
    } else if (n.kind === "neg") {
      walk(n.expr, insideAgg);
    }
  };
  walk(ast, false);
  return Array.from(out);
}

/**
 * Пытается убрать внешний агрегат вокруг уже-агрегатного поля:
 *   SUM([installs])  → [installs]
 *   AVG( [leads] ) → [leads]
 * Делает это текстом (регэксп), чтобы не трогать AST/движок. Безопасно: меняет
 * только обёртки `<AGG>([<name>])`, где name — одно из `targets`.
 */
function stripOuterAggOf(formula: string, targets: string[]): string {
  let out = formula;
  const aggAlt = AGG_NAMES.join("|");
  for (const name of targets) {
    // экранируем имя для regexp
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // <AGG> ( [ name ] ) с произвольными пробелами → [name]
    const re = new RegExp(
      `\\b(?:${aggAlt})\\s*\\(\\s*\\[\\s*${esc}\\s*\\]\\s*\\)`,
      "gi",
    );
    out = out.replace(re, `[${name}]`);
  }
  return out;
}

/** Балансирует скобки: добавляет недостающие `)` в конец / убирает лишние с конца. */
function balanceParens(formula: string): string | null {
  let depth = 0;
  for (const ch of formula) {
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth < 0) return null; // закрывающая раньше открывающей — однозначно не починить
    }
  }
  if (depth > 0) return formula + ")".repeat(depth);
  return formula; // уже сбалансировано
}

/**
 * Главная функция: по формуле и доступным колонкам возвращает понятное
 * объяснение + возможный автофикс. Возвращает `null`, если формула валидна.
 */
export function explainFormulaError(
  formula: string,
  availableColumns: string[],
  isAggregateRef: (name: string) => boolean = () => false,
): FormulaHelp | null {
  const res = validateFormula(formula, availableColumns, isAggregateRef);
  if (res.ok) return null;

  // 1. Неизвестные столбцы.
  if (res.unknown && res.unknown.length > 0) {
    const names = res.unknown.join(", ");
    // Подсказываем близкие имена, если есть.
    const suggestions = res.unknown
      .map((u) => closest(u, availableColumns))
      .filter((s): s is string => !!s);
    const hint =
      suggestions.length > 0
        ? ` Возможно, вы имели в виду: ${Array.from(new Set(suggestions)).join(", ")}.`
        : "";
    return {
      message:
        `Не нашли в датасете ${res.unknown.length > 1 ? "поля" : "поле"}: ${names}. ` +
        `Имена колонок указывайте в квадратных скобках, например [cost].${hint}`,
    };
  }

  // 2. Вложенный агрегат: SUM([поле, которое уже агрегат]).
  if (/вложенные агрегатные/i.test(res.error ?? "")) {
    let targets: string[] = [];
    try {
      targets = aggregatedAggRefs(parseFormula(formula), isAggregateRef);
    } catch {
      targets = [];
    }
    if (targets.length > 0) {
      const fixed = stripOuterAggOf(formula, targets);
      const list = targets.join(", ");
      const plural = targets.length > 1;
      const message =
        `${plural ? "Поля" : "Поле"} ${list} ${plural ? "уже" : "уже"} ` +
        `${plural ? "просуммированы" : "просуммировано"}. Не нужно оборачивать ` +
        `${plural ? "их" : "его"} в SUM() второй раз — используйте просто ` +
        `${targets.map((t) => `[${t}]`).join(", ")}.`;
      // Показываем автофикс только если он реально что-то меняет и становится валидным.
      if (
        fixed !== formula &&
        validateFormula(fixed, availableColumns, isAggregateRef).ok
      ) {
        return { message, fix: fixed, fixLabel: "Убрать лишний SUM()" };
      }
      return { message };
    }
    return {
      message:
        "Агрегатная функция внутри другой агрегатной (например SUM(AVG(...))) " +
        "не поддерживается. Уберите внешнюю функцию.",
    };
  }

  // 3. Микс уровней: часть колонок в SUM(), часть — нет.
  if (/либо все колонки|нельзя смешивать/i.test(res.error ?? "")) {
    return {
      message:
        "В одной формуле нельзя смешивать «сырые» колонки и агрегаты. Либо " +
        "оберните каждую сырую колонку в SUM() (например SUM([cost]) / SUM([installs])), " +
        "либо не используйте SUM() вовсе.",
    };
  }

  // 4. Скобки.
  if (/закрывающая скобка|закрывающая\s*\)|ожидалась.*скобк/i.test(res.error ?? "")) {
    const balanced = balanceParens(formula);
    const base =
      "Скобки не сходятся — где-то не хватает закрывающей «)» или есть лишняя.";
    if (
      balanced &&
      balanced !== formula &&
      validateFormula(balanced, availableColumns, isAggregateRef).ok
    ) {
      return { message: base, fix: balanced, fixLabel: "Закрыть скобки" };
    }
    return { message: base };
  }

  // 5. Скобка для имени столбца.
  if (/скобка \] для имени|пустое имя столбца/i.test(res.error ?? "")) {
    return {
      message:
        "Имя колонки нужно писать в квадратных скобках полностью: [cost]. " +
        "Проверьте, что каждая «[» закрыта «]».",
    };
  }

  // 6. Прочий синтаксис.
  if (
    /неизвестный символ|неожиданн|лишние символы|некорректное число|неизвестная функция/i.test(
      res.error ?? "",
    )
  ) {
    return {
      message:
        "Формула написана с ошибкой. Используйте колонки в скобках ([cost]), " +
        "числа, операторы + − × ÷ и функции SUM/AVG/COUNT/MIN/MAX. " +
        `Например: [cost] / [installs]. (${res.error})`,
    };
  }

  // 7. Фоллбэк — отдаём исходный текст, но обёрнутый по-человечески.
  return {
    message: res.error
      ? `Формула невалидна: ${res.error}`
      : "Формула невалидна.",
  };
}

/** Простейший подбор близкого имени по расстоянию Левенштейна (для опечаток). */
function closest(target: string, options: string[]): string | null {
  const t = target.toLowerCase();
  let best: string | null = null;
  let bestDist = Infinity;
  for (const o of options) {
    const d = levenshtein(t, o.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = o;
    }
  }
  // показываем подсказку только если она «достаточно близкая»
  return best !== null && bestDist <= Math.max(2, Math.floor(t.length / 3))
    ? best
    : null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
