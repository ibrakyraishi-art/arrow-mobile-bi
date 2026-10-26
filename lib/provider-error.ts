/**
 * Достаёт человеко-читаемое сообщение об ошибке из тела ответа LLM-провайдера.
 *
 * Разные провайдеры кладут сообщение по-разному: Anthropic/OpenAI/Groq/Google —
 * `{error:{message}}`; Cerebras/Mistral иногда `{message}` или `{detail}`;
 * бывает и `{error:"строка"}`. Если тело — не JSON (например, HTML-страница
 * 404 от прокси), возвращаем короткий осмысленный фрагмент, иначе null.
 *
 * Используется и в `/api/ai/analyze` (показать причину сбоя анализа), и при
 * проверке ключа в `/api/settings/api-key` — чтобы пользователь видел реальную
 * причину, а не голый «HTTP 404».
 */
export function extractProviderError(s: string): string | null {
  const text = (s ?? "").trim();
  if (!text) return null;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const err = j.error;
    if (typeof err === "string" && err.trim()) return err.trim();
    if (err && typeof err === "object") {
      const m = (err as Record<string, unknown>).message;
      if (typeof m === "string" && m.trim()) return m.trim();
    }
    for (const key of ["message", "detail", "msg"]) {
      const v = j[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  } catch {
    // Не JSON (HTML/текст). Берём короткий фрагмент, если он не разметка.
    if (text.length <= 200 && !text.startsWith("<")) return text;
    return null;
  }
}

/**
 * Похоже ли на проблему с БАЛАНСОМ/оплатой у провайдера: ключ валиден, но на
 * счёте нет средств/кредитов или исчерпана квота. Нужно, чтобы показать
 * пользователю понятное «пополните баланс», а не сырую ошибку — он подключил
 * токен и не понимает, почему анализ не идёт. Сигнатуры разных провайдеров:
 * Anthropic «credit balance is too low… purchase credits», OpenAI
 * «insufficient_quota / exceeded your current quota / billing details»,
 * общий HTTP 402 Payment Required.
 */
const BALANCE_HINTS = [
  "credit balance",
  "too low to access",
  "purchase credits",
  "buy credits",
  "out of credits",
  "insufficient_quota",
  "insufficient quota",
  "insufficient funds",
  "insufficient balance",
  "exceeded your current quota",
  "billing details",
  "plans & billing",
  "plans and billing",
  "payment required",
  "недостаточно средств",
  "недостаточно кредитов",
  "пополните баланс",
  "исчерпана квота",
];
export function isBalanceError(text: string | null | undefined): boolean {
  const t = (text ?? "").toLowerCase();
  return t.length > 0 && BALANCE_HINTS.some((h) => t.includes(h));
}
