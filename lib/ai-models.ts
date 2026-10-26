import type { AIModelId, AIProvider } from "@/lib/types";

export type { AIProvider } from "@/lib/types";

/** Как устроен API провайдера — определяет вызов и разбор SSE. */
export type ApiKind = "anthropic" | "openai-compatible" | "google";

export interface AIModelInfo {
  id: AIModelId;
  provider: AIProvider;
  /** Идентификатор модели в API провайдера. */
  apiId: string;
  label: string;
  icon: string;
  tagline: string;
  /** USD per 1M input tokens (ориентировочно — для оценки стоимости). */
  priceInput: number;
  /** USD per 1M output tokens (ориентировочно). */
  priceOutput: number;
  /** Есть бесплатный лимит у провайдера. */
  free?: boolean;
  badge: string;
  badgeVariant: "default" | "success" | "outline";
}

/**
 * Реестр всех моделей по всем провайдерам. Ключи `haiku/sonnet/opus` сохранены
 * для обратной совместимости (старые проекты хранят их в БД). Цены ориентировочные.
 */
export const AI_MODELS: Record<string, AIModelInfo> = {
  // --- Anthropic (Claude) ---
  haiku: {
    id: "haiku",
    provider: "anthropic",
    apiId: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    icon: "⚡",
    tagline: "Быстрый, базовый",
    priceInput: 0.25,
    priceOutput: 1.25,
    badge: "Экономный",
    badgeVariant: "outline",
  },
  sonnet: {
    id: "sonnet",
    provider: "anthropic",
    apiId: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    icon: "✨",
    tagline: "Умный, сбалансированный",
    priceInput: 3,
    priceOutput: 15,
    badge: "Рекомендуется",
    badgeVariant: "success",
  },
  opus: {
    id: "opus",
    provider: "anthropic",
    apiId: "claude-opus-4-8",
    label: "Opus 4.8",
    icon: "🧠",
    tagline: "Глубокий, стратегический",
    priceInput: 15,
    priceOutput: 75,
    badge: "Премиум",
    badgeVariant: "default",
  },
  // --- OpenAI (GPT) ---
  "gpt-4o": {
    id: "gpt-4o",
    provider: "openai",
    apiId: "gpt-4o",
    label: "GPT-4o",
    icon: "🟢",
    tagline: "Универсальный флагман OpenAI",
    priceInput: 2.5,
    priceOutput: 10,
    badge: "OpenAI",
    badgeVariant: "default",
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    provider: "openai",
    apiId: "gpt-4o-mini",
    label: "GPT-4o mini",
    icon: "🟢",
    tagline: "Дешёвый и быстрый",
    priceInput: 0.15,
    priceOutput: 0.6,
    badge: "Экономный",
    badgeVariant: "outline",
  },
  // --- Google (Gemini) — есть бесплатный лимит ---
  "gemini-2.0-flash": {
    id: "gemini-2.0-flash",
    provider: "google",
    apiId: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    icon: "🔵",
    tagline: "Очень дёшево, есть free-tier",
    priceInput: 0.1,
    priceOutput: 0.4,
    free: true,
    badge: "Free-tier",
    badgeVariant: "success",
  },
  "gemini-1.5-pro": {
    id: "gemini-1.5-pro",
    provider: "google",
    apiId: "gemini-1.5-pro",
    label: "Gemini 1.5 Pro",
    icon: "🔵",
    tagline: "Мощная модель Google",
    priceInput: 1.25,
    priceOutput: 5,
    badge: "Google",
    badgeVariant: "default",
  },
  // --- Groq (Llama / DeepSeek) — щедрый бесплатный лимит, очень быстро ---
  "groq-llama-3.3-70b": {
    id: "groq-llama-3.3-70b",
    provider: "groq",
    apiId: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    icon: "🦙",
    tagline: "Groq · быстро и бесплатно",
    priceInput: 0.59,
    priceOutput: 0.79,
    free: true,
    badge: "Free-tier",
    badgeVariant: "success",
  },
  "groq-llama-3.1-8b": {
    id: "groq-llama-3.1-8b",
    provider: "groq",
    apiId: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B",
    icon: "🦙",
    tagline: "Groq · мгновенный, бесплатно",
    priceInput: 0.05,
    priceOutput: 0.08,
    free: true,
    badge: "Free-tier",
    badgeVariant: "success",
  },
  // --- Cerebras (Llama) — бесплатный лимит, рекордная скорость ---
  "cerebras-llama-3.3-70b": {
    id: "cerebras-llama-3.3-70b",
    provider: "cerebras",
    apiId: "llama-3.3-70b",
    label: "Llama 3.3 70B",
    icon: "⚡",
    tagline: "Cerebras · сверхбыстро, free",
    priceInput: 0.85,
    priceOutput: 1.2,
    free: true,
    badge: "Free-tier",
    badgeVariant: "success",
  },
  "cerebras-llama-3.1-8b": {
    id: "cerebras-llama-3.1-8b",
    provider: "cerebras",
    apiId: "llama3.1-8b",
    label: "Llama 3.1 8B",
    icon: "⚡",
    tagline: "Cerebras · мгновенный, free",
    priceInput: 0.1,
    priceOutput: 0.1,
    free: true,
    badge: "Free-tier",
    badgeVariant: "success",
  },
  // --- Mistral — бесплатный tier ---
  "mistral-small": {
    id: "mistral-small",
    provider: "mistral",
    apiId: "mistral-small-latest",
    label: "Mistral Small",
    icon: "🌬️",
    tagline: "Mistral · есть free-tier",
    priceInput: 0.2,
    priceOutput: 0.6,
    free: true,
    badge: "Free-tier",
    badgeVariant: "success",
  },
  "mistral-nemo": {
    id: "mistral-nemo",
    provider: "mistral",
    apiId: "open-mistral-nemo",
    label: "Mistral Nemo",
    icon: "🌬️",
    tagline: "Mistral · лёгкий, free-tier",
    priceInput: 0.15,
    priceOutput: 0.15,
    free: true,
    badge: "Free-tier",
    badgeVariant: "success",
  },
};

export const DEFAULT_MODEL: AIModelId = "sonnet";

/** Порядок моделей в выпадашке. */
export const MODEL_ORDER: AIModelId[] = [
  "haiku",
  "sonnet",
  "opus",
  "gpt-4o",
  "gpt-4o-mini",
  "gemini-2.0-flash",
  "gemini-1.5-pro",
  "groq-llama-3.3-70b",
  "groq-llama-3.1-8b",
  "cerebras-llama-3.3-70b",
  "cerebras-llama-3.1-8b",
  "mistral-small",
  "mistral-nemo",
];

/** Безопасно достаёт инфо о модели по id (с фоллбэком на дефолт). */
export function resolveModel(id: string | undefined | null): AIModelInfo {
  return (id ? AI_MODELS[id] : undefined) ?? AI_MODELS[DEFAULT_MODEL];
}

/**
 * Первая модель (в порядке `MODEL_ORDER`), провайдер которой подключён.
 * Нужна, чтобы анализ «просто работал» на той LLM, что подключил пользователь,
 * не требуя именно Anthropic. Возвращает null, если не подключён ни один.
 */
export function firstConfiguredModelId(
  isConfigured: (p: AIProvider) => boolean,
): AIModelId | null {
  for (const id of MODEL_ORDER) {
    if (isConfigured(resolveModel(id).provider)) return id;
  }
  return null;
}

/**
 * apiId первой (основной) модели провайдера в порядке `MODEL_ORDER`. Нужен,
 * чтобы проверять ключ РЕАЛЬНЫМ вызовом чат-эндпоинта той моделью, которой
 * пользователь и будет пользоваться (а не только `/models`).
 */
export function firstApiIdForProvider(provider: AIProvider): string | null {
  for (const id of MODEL_ORDER) {
    const m = resolveModel(id);
    if (m.provider === provider) return m.apiId;
  }
  return null;
}

/** Столбец БД с (зашифрованным) ключом каждого провайдера. */
export const KEY_COLUMN: Record<AIProvider, string> = {
  anthropic: "anthropic_api_key",
  openai: "openai_api_key",
  google: "google_api_key",
  groq: "groq_api_key",
  cerebras: "cerebras_api_key",
  mistral: "mistral_api_key",
};

/** Все провайдеры в порядке отображения. */
export const PROVIDER_LIST: AIProvider[] = [
  "anthropic",
  "openai",
  "google",
  "groq",
  "cerebras",
  "mistral",
];

/**
 * Провайдеры, ДОСТУПНЫЕ для выбора прямо сейчас. Остальные показываются в
 * выпадашке как «скоро» (интеграция в разработке) и не выбираются. Бэкенд
 * остаётся провайдеро-агностичным — это только UI-гейт: чтобы открыть провайдера,
 * достаточно добавить его сюда.
 */
export const ENABLED_PROVIDERS: AIProvider[] = ["anthropic"];
export function isProviderEnabled(p: AIProvider): boolean {
  return ENABLED_PROVIDERS.includes(p);
}

/** Метаданные провайдера: API-вид/база (для вызова) + UI (ссылки, инструкция). */
export const PROVIDERS: Record<
  AIProvider,
  {
    label: string;
    icon: string;
    apiKind: ApiKind;
    /** База для openai-совместимых (без завершающего слэша). */
    baseUrl?: string;
    keyPlaceholder: string;
    keyHint: string;
    consoleUrl: string;
    consoleLabel: string;
    steps: string[];
  }
> = {
  anthropic: {
    label: "Anthropic (Claude)",
    icon: "🟣",
    apiKind: "anthropic",
    keyPlaceholder: "sk-ant-...",
    keyHint: "начинается с sk-ant-",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    consoleLabel: "console.anthropic.com",
    steps: [
      "Зарегистрируйтесь на console.anthropic.com",
      "Billing → пополните баланс (от $5)",
      "API Keys → Create Key → скопируйте sk-ant-…",
    ],
  },
  openai: {
    label: "OpenAI (GPT)",
    icon: "🟢",
    apiKind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    keyPlaceholder: "sk-...",
    keyHint: "начинается с sk-",
    consoleUrl: "https://platform.openai.com/api-keys",
    consoleLabel: "platform.openai.com",
    steps: [
      "Зарегистрируйтесь на platform.openai.com",
      "Settings → Billing → добавьте средства",
      "API keys → Create new secret key → скопируйте sk-…",
    ],
  },
  google: {
    label: "Google (Gemini)",
    icon: "🔵",
    apiKind: "google",
    keyPlaceholder: "AIza...",
    keyHint: "ключ Google AI Studio · есть free-tier",
    consoleUrl: "https://aistudio.google.com/apikey",
    consoleLabel: "aistudio.google.com",
    steps: [
      "Откройте aistudio.google.com/apikey",
      "Create API key (есть бесплатный лимит)",
      "Скопируйте ключ AIza…",
    ],
  },
  groq: {
    label: "Groq (Llama)",
    icon: "🦙",
    apiKind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    keyPlaceholder: "gsk_...",
    keyHint: "щедрый бесплатный лимит",
    consoleUrl: "https://console.groq.com/keys",
    consoleLabel: "console.groq.com",
    steps: [
      "Зарегистрируйтесь на console.groq.com (бесплатно)",
      "API Keys → Create API Key",
      "Скопируйте gsk_… — есть щедрый бесплатный лимит",
    ],
  },
  cerebras: {
    label: "Cerebras (Llama)",
    icon: "⚡",
    apiKind: "openai-compatible",
    baseUrl: "https://api.cerebras.ai/v1",
    keyPlaceholder: "csk-...",
    keyHint: "бесплатный лимит, рекордная скорость",
    consoleUrl: "https://cloud.cerebras.ai",
    consoleLabel: "cloud.cerebras.ai",
    steps: [
      "Зарегистрируйтесь на cloud.cerebras.ai (бесплатно)",
      "API Keys → Generate API Key",
      "Скопируйте ключ — есть бесплатный лимит",
    ],
  },
  mistral: {
    label: "Mistral",
    icon: "🌬️",
    apiKind: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    keyPlaceholder: "ключ Mistral",
    keyHint: "есть бесплатный tier",
    consoleUrl: "https://console.mistral.ai/api-keys",
    consoleLabel: "console.mistral.ai",
    steps: [
      "Зарегистрируйтесь на console.mistral.ai",
      "API Keys → Create new key (есть free-tier)",
      "Скопируйте ключ",
    ],
  },
};

/** Оценка стоимости запроса (USD) при заданном числе входных/выходных токенов. */
export function estimateModelCost(
  modelId: AIModelId,
  inputTokens: number,
  outputTokens: number,
): number {
  const m = resolveModel(modelId);
  return (
    (inputTokens / 1_000_000) * m.priceInput +
    (outputTokens / 1_000_000) * m.priceOutput
  );
}
