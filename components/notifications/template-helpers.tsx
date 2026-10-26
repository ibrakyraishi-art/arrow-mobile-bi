"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Dataset, TelegramParseMode } from "@/lib/types";

// Теги, которые поддерживает Telegram в HTML-режиме (простые, без атрибутов).
const TG_ALLOWED_TAGS = [
  "b", "strong", "i", "em", "u", "ins", "s", "strike", "del",
  "code", "pre", "blockquote", "tg-spoiler",
];

/**
 * Безопасный рендер HTML-превью Telegram-шаблона. Экранируем ВСЁ, затем
 * возвращаем только разрешённый Telegram набор тегов (и `<a href="http(s)://…">`).
 * Так в превью не выполнится произвольный HTML/JS (защита от self-XSS), а
 * форматирование при этом видно как в Telegram. Без внешних зависимостей.
 */
export function sanitizeTelegramHtml(raw: string): string {
  let out = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  for (const tag of TG_ALLOWED_TAGS) {
    out = out.replace(
      new RegExp(`&lt;(/?)${tag}&gt;`, "gi"),
      (_m, slash) => `<${slash}${tag}>`,
    );
  }
  // Ссылки: разрешаем только http/https; href отдаём как безопасный текст.
  out = out.replace(
    /&lt;a href=&quot;(https?:\/\/[^\s<>]*?)&quot;&gt;/gi,
    (_m, url) => `<a href="${url}" target="_blank" rel="noreferrer noopener">`,
  );
  out = out.replace(/&lt;\/a&gt;/gi, "</a>");
  return out;
}

interface VarItem {
  name: string;
  description: string;
}

export interface VarGroup {
  title: string;
  items: VarItem[];
}

export const AVAILABLE_VARIABLES: VarGroup[] = [
  {
    title: "Главное",
    items: [
      { name: "table", description: "вставит таблицу из конструктора" },
    ],
  },
  {
    title: "Общие",
    items: [
      { name: "user_email", description: "Email пользователя" },
      { name: "dataset_name", description: "Имя датасета" },
      { name: "period_label", description: "Период анализа" },
      { name: "now", description: "Текущее время (ISO)" },
      { name: "rule_name", description: "Имя правила" },
    ],
  },
  {
    title: "Из срабатывания",
    items: [
      { name: "matches_count", description: "Количество найденных объектов" },
      { name: "top_objects", description: "Топ объектов по условиям" },
      { name: "tag_users", description: "Список тегов из правила" },
      {
        name: "creative_name",
        description: "Имя первого совпавшего объекта",
      },
    ],
  },
];

export const PREVIEW_VALUES: Record<string, string> = {
  user_email: "buyer@example.com",
  dataset_name: "Yango креативы",
  period_label: "3 дня",
  now: new Date().toISOString(),
  rule_name: "ROAS низкий",
  matches_count: "5",
  table:
    "code  Расход  Подписки\n────  ──────  ────────\nabc    120.30        45\nxyz     84.10        31",
  top_objects:
    "• Creative_42_v1: roas=0.45, spend=120.30\n• Creative_17_v2: roas=0.61, spend=84.10",
  tag_users: "@ivan, @maria",
  creative_name: "Creative_42_v1",
};

/**
 * Доп. группы переменных, доступные при срабатывании правила по конкретному
 * датасету. Колонки матч-строки `buildVariables` экспонирует как
 * `{column_name}` (если имя валидно и не перетирает фиксированные).
 * Вычисляемые поля попадают сюда же — в SQL-агрегации они вычисляются
 * отдельно и тоже доступны через имя поля.
 */
export function buildDatasetVariableGroups(
  dataset: Dataset | undefined,
): VarGroup[] {
  if (!dataset) return [];
  const fixed = new Set([
    "user_email",
    "dataset_name",
    "period_label",
    "now",
    "matches_count",
    "table",
    "top_objects",
    "ai_recommendation",
    "tag_users",
    "rule_name",
    "creative_name",
  ]);
  const isValidName = (n: string) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n);

  const cols: VarItem[] = [];
  for (const c of dataset.columns) {
    if (c.enabled === false) continue;
    if (!isValidName(c.name) || fixed.has(c.name)) continue;
    cols.push({
      name: c.name,
      description: c.businessContext || c.description || c.datasetType,
    });
  }

  const calc: VarItem[] = [];
  for (const cf of dataset.calculatedFields ?? []) {
    if (!isValidName(cf.name) || fixed.has(cf.name)) continue;
    calc.push({
      name: cf.name,
      description:
        cf.aiDescription || cf.description || `ƒx ${cf.formula}`,
    });
  }

  const out: VarGroup[] = [];
  if (cols.length > 0) out.push({ title: "Колонки датасета", items: cols });
  if (calc.length > 0)
    out.push({ title: "Вычисляемые поля (ƒx)", items: calc });
  return out;
}

export function renderPreviewText(
  body: string,
  values: Record<string, string>,
): string {
  // Ссылки на таблицы других правил {table:Имя} — в статическом превью
  // показываем заглушкой (реальная таблица подставится при срабатывании).
  let out = body.replace(/\{table:([^{}]+)\}/g, (_full, rn: string) => {
    return `[таблица правила «${rn.trim()}»]`;
  });
  out = out.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (full, name: string) => {
    const v = values[name];
    return typeof v === "string" ? v : full;
  });
  return out;
}

export function TemplatePreview({
  body,
  parseMode,
  values,
}: {
  body: string;
  parseMode: TelegramParseMode;
  values: Record<string, string>;
}) {
  const text = renderPreviewText(body, values);

  if (
    parseMode === "markdown" ||
    parseMode === "markdownv2" ||
    parseMode === "html"
  ) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
        {parseMode === "markdown" || parseMode === "markdownv2" ? (
          <div className="prose prose-invert max-w-none prose-p:my-1 prose-pre:my-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {sanitizeMarkdownV2ForPreview(text)}
            </ReactMarkdown>
          </div>
        ) : (
          <div
            className="whitespace-pre-wrap"
            dangerouslySetInnerHTML={{ __html: sanitizeTelegramHtml(text) }}
          />
        )}
      </div>
    );
  }

  return (
    <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-xs text-foreground/90">
      {text}
    </pre>
  );
}

/** Telegram MarkdownV2 экранирует много символов; для превью убираем
 *  одиночные backslash перед безопасными символами, чтобы рендерилось
 *  ближе к тому, как видит юзер. */
function sanitizeMarkdownV2ForPreview(s: string): string {
  return s.replace(/\\([_*\[\]()~`>#+\-=|{}.!])/g, "$1");
}
