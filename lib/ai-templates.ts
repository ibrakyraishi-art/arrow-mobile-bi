export type QuickActionId =
  | "diagnostics"
  | "funnel"
  | "budget"
  | "trends"
  | "comparison"
  | "report";

export interface QuickAction {
  id: QuickActionId;
  icon: string;
  title: string;
  description: string;
  /** System prompt-шаблон для этого действия. Вставляется в system как «роль». */
  systemPrompt: string;
  /** User-prompt по умолчанию (то, что пользователь увидит в textarea после клика). */
  userPrompt: string;
  /** Если true — перед отправкой нужно собрать дополнительный ввод. */
  requiresInput?: boolean;
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "diagnostics",
    icon: "🔍",
    title: "Диагностика",
    description: "Найду проблемы и предложу решения",
    systemPrompt:
      "Ты — старший медиабайер-аналитик. Проведи диагностику кампаний. Найди: 1) убыточные кампании (ROI<100%), 2) аномалии, 3) неэффективные комбинации. По каждой проблеме — рекомендация с цифрами.",
    userPrompt:
      "Проведи диагностику кампаний. Найди проблемы и дай конкретные рекомендации с цифрами.",
  },
  {
    id: "funnel",
    icon: "📊",
    title: "Воронка",
    description: "Где теряются деньги на каждом этапе",
    systemPrompt:
      "Проанализируй воронку конверсий. Рассчитай конверсию каждого перехода. Найди этап с наибольшими потерями. Разбей по регионам и платформам.",
    userPrompt:
      "Проанализируй воронку: где теряются деньги на каждом этапе? Разбей по регионам и платформам.",
  },
  {
    id: "budget",
    icon: "💰",
    title: "Бюджет",
    description: "Куда перераспределить деньги",
    systemPrompt:
      "Проанализируй ROI по комбинациям регион×платформа. Предложи оптимальное распределение. Покажи текущее vs рекомендуемое в таблице. Оцени эффект в деньгах.",
    userPrompt:
      "Как перераспределить бюджет? Покажи текущее vs рекомендуемое распределение и оцени эффект в деньгах.",
  },
  {
    id: "trends",
    icon: "📈",
    title: "Тренды",
    description: "Что растёт, что падает, почему",
    systemPrompt:
      "Проанализируй динамику метрик по датам. Найди растущие/падающие тренды, сезонность, аномальные дни. Дай прогноз.",
    userPrompt:
      "Какие тренды в данных? Что растёт, что падает, почему? Найди сезонность и аномалии, дай прогноз.",
  },
  {
    id: "comparison",
    icon: "🆚",
    title: "Сравнение",
    description: "Сравни регионы, платформы, периоды",
    systemPrompt:
      "Сравни сегменты по spend, revenue, ROI, CTR, CPC. Сделай таблицу + выбери победителя + дай рекомендации.",
    userPrompt: "",
    requiresInput: true,
  },
  {
    id: "report",
    icon: "📄",
    title: "Отчёт",
    description: "Готовый отчёт для клиента",
    systemPrompt:
      "Создай профессиональный отчёт: 1) Общие показатели, 2) Динамика, 3) ТОП-5 и АНТИТОП-5, 4) По регионам, 5) По платформам, 6) Рекомендации.",
    userPrompt:
      "Подготовь профессиональный отчёт для клиента: общие показатели, динамика, ТОП-5/АНТИТОП-5, разбивки, рекомендации.",
  },
];

export function getQuickAction(id: QuickActionId): QuickAction {
  const a = QUICK_ACTIONS.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown quick action: ${id}`);
  return a;
}
