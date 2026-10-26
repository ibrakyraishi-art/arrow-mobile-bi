export type FeedbackStatus = "new" | "in_progress" | "resolved";

export const FEEDBACK_STATUSES: FeedbackStatus[] = [
  "new",
  "in_progress",
  "resolved",
];

/** Подпись и цветовые классы статуса заявки. */
export const FEEDBACK_STATUS_META: Record<
  FeedbackStatus,
  { label: string; cls: string }
> = {
  new: {
    label: "Новая",
    cls: "border-warning/40 bg-warning/10 text-warning",
  },
  in_progress: {
    label: "В работе",
    cls: "border-brand-500/40 bg-brand-500/10 text-brand-500",
  },
  resolved: {
    label: "Исправлено",
    cls: "border-success/40 bg-success/10 text-success",
  },
};

/** Дата/время в часовом поясе Europe/Moscow. */
export function fmtMoscow(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
