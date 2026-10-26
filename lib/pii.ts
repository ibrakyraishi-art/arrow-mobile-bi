import type { QueryResultRow } from "@/lib/types";

// Имена столбцов, похожие на персональные данные (email / телефон / документы).
const PII_NAME_RE =
  /(e[-_ ]?mail|почт|\bmail\b|phone|тел\b|телефон|msisdn|номер|passport|паспорт|\binn\b|\bинн\b|snils|снилс|card|карт|iban|cvv|cvc)/i;

const EMAIL_VAL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Похоже на телефон: цифры + телефонные разделители (чтобы не путать с ID/числами).
const PHONE_VAL = /^\+?[\d][\d\s()\-]{8,}$/;
const PHONE_SEP = /[+()\s-]/;

/**
 * Эвристически находит столбцы, похожие на ПЕРСОНАЛЬНЫЕ ДАННЫЕ (PII), чтобы
 * предупредить пользователя перед отправкой в LLM, если он их не замаскировал.
 * Срабатывает по имени столбца ИЛИ по значениям (email / телефон) в выборке.
 * Заведомо «шумит» в сторону осторожности — это предупреждение, не блокировка.
 */
export function detectPiiColumns(
  rows: QueryResultRow[],
  sample = 50,
): string[] {
  if (!rows || rows.length === 0) return [];
  const keys = Object.keys(rows[0]);
  const sampleRows = rows.slice(0, sample);
  const out: string[] = [];

  for (const key of keys) {
    if (PII_NAME_RE.test(key)) {
      out.push(key);
      continue;
    }
    let nonEmpty = 0;
    let hits = 0;
    for (const r of sampleRows) {
      const v = r[key];
      if (v === null || v === undefined || v === "") continue;
      const s = String(v).trim();
      nonEmpty++;
      const digits = s.replace(/\D/g, "");
      const looksPhone =
        PHONE_VAL.test(s) &&
        PHONE_SEP.test(s) &&
        digits.length >= 10 &&
        digits.length <= 15;
      if (EMAIL_VAL.test(s) || looksPhone) hits++;
    }
    // Нужно несколько непустых значений и явное большинство «похожих».
    if (nonEmpty >= 3 && hits / nonEmpty >= 0.6) out.push(key);
  }
  return out;
}
