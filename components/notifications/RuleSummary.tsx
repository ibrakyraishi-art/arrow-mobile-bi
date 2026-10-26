"use client";

import type {
  AlertCondition,
  AlertScheduleType,
  Dataset,
  NotificationTemplate,
  ScheduleConfig,
  TelegramConnection,
} from "@/lib/types";
import { formatAlertCondition } from "@/lib/types";

/**
 * Краткая «что делает это правило» сводка над формой.
 * Цель: за 5 секунд понять результат ручной настройки, не вчитываясь
 * в каждую секцию.
 */
export function RuleSummary({
  datasetId,
  datasets,
  groupBy,
  periodDays,
  conditions,
  minSpendFilter,
  telegramConnectionId,
  connections,
  templateId,
  templates,
  tagUsers,
  schedule,
}: {
  datasetId: string;
  datasets: Dataset[];
  groupBy: string[];
  periodDays: number;
  conditions: AlertCondition[];
  minSpendFilter: string;
  telegramConnectionId: string;
  connections: TelegramConnection[];
  templateId: string;
  templates: NotificationTemplate[];
  tagUsers: string;
  schedule: ScheduleConfig;
}) {
  const dataset = datasets.find((d) => d.id === datasetId);
  const connection = connections.find((c) => c.id === telegramConnectionId);
  const template = templates.find((t) => t.id === templateId);

  return (
    <div className="space-y-2 rounded-lg border border-brand-500/30 bg-brand-500/5 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-brand-500">
        Что делает это правило
      </div>

      <ul className="space-y-1 text-sm">
        <li>
          📦 Берёт из{" "}
          <span className="font-mono text-xs">
            {dataset?.name ?? "—"}
          </span>{" "}
          данные за{" "}
          <span className="font-semibold">
            {periodDays} {pluralDays(periodDays)}
          </span>
          .
        </li>
        <li>
          🔑 Группирует по{" "}
          {groupBy.length === 0 ? (
            <span className="text-destructive">— нет группировки —</span>
          ) : (
            <span className="font-mono text-xs">
              {groupBy.join(" + ")}
            </span>
          )}
          {minSpendFilter && Number(minSpendFilter) > 0 ? (
            <>
              ; фильтр «расход ≥ ${minSpendFilter}».
            </>
          ) : (
            <>.</>
          )}
        </li>
        <li>
          🎯 Срабатывает когда:
          {conditions.length === 0 ? (
            <span className="text-destructive"> любая строка </span>
          ) : (
            <ol className="mt-1 space-y-0.5 pl-4 text-xs">
              {conditions.map((c, i) => (
                <li key={i} className="font-mono text-muted-foreground">
                  {i + 1}. {formatAlertCondition(c)}
                </li>
              ))}
            </ol>
          )}
        </li>
        <li>
          📅 {scheduleHuman(schedule)}.
        </li>
        <li>
          📨 Шлёт в{" "}
          <span className="font-mono text-xs">
            {connection
              ? `${connection.name} (@${connection.botUsername})`
              : "—"}
          </span>{" "}
          по шаблону{" "}
          <span className="font-mono text-xs">
            «{template?.name ?? "—"}»
          </span>
          {tagUsers.trim() ? (
            <>
              ; теги <span className="font-mono text-xs">{tagUsers}</span>
            </>
          ) : null}
          .
        </li>
      </ul>
    </div>
  );
}

function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20))
    return "дня";
  return "дней";
}

const WEEK_LABEL: Record<number, string> = {
  0: "Вс",
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
};

function scheduleHuman(s: ScheduleConfig): string {
  const t: AlertScheduleType = s.type;
  if (t === "trigger_only") return "Запуск только вручную / по триггеру";
  if (t === "every_n_hours")
    return `Каждые ${s.intervalHours ?? 6} часов`;
  if (t === "daily") return `Ежедневно в ${s.time ?? "09:00"}`;
  const days =
    Array.isArray(s.daysOfWeek) && s.daysOfWeek.length > 0
      ? s.daysOfWeek.map((d) => WEEK_LABEL[d] ?? d).join(", ")
      : "—";
  if (t === "weekly") return `Еженедельно (${days}) в ${s.time ?? "09:00"}`;
  if (t === "twice_weekly")
    return `Два раза в неделю (${days}) в ${s.time ?? "09:00"}`;
  return "—";
}
