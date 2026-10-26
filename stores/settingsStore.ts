import { create } from "zustand";
import type { AIAnalysis, AppSettings } from "@/lib/types";
import { PROVIDER_LIST, type AIProvider } from "@/lib/ai-models";
import { DEFAULT_THEME, storeTheme } from "@/lib/theme";
import {
  clearAnalyses as sbClearAnalyses,
  createAnalysis as sbCreateAnalysis,
  deleteAnalysis as sbDeleteAnalysis,
  getAnalyses as sbGetAnalyses,
  getUserSettings as sbGetSettings,
  upsertUserSettings as sbUpsertSettings,
} from "@/lib/supabase-db";

interface SettingsState {
  settings: AppSettings;
  analyses: AIAnalysis[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  currentUserId: string | null;

  loadFromSupabase: (userId: string) => Promise<void>;
  /**
   * Залить настройки, уже загруженные и санитизированные сервером
   * (/api/bootstrap). `settings.providerKeys` содержит маркеры, не ключи.
   */
  hydrate: (
    userId: string,
    settings: AppSettings,
    analyses: AIAnalysis[],
  ) => void;
  setApiKey: (
    provider: AIProvider,
    key: string,
  ) => Promise<{ verified: boolean; warning?: string }>;
  setTheme: (theme: "dark" | "light") => Promise<void>;
  addAnalysis: (a: Omit<AIAnalysis, "id">) => Promise<AIAnalysis>;
  removeAnalysis: (id: string) => Promise<void>;
  clearAnalyses: () => Promise<void>;
  reset: () => void;
}

const emptyKeys = (): Record<AIProvider, string> =>
  Object.fromEntries(PROVIDER_LIST.map((p) => [p, ""])) as Record<
    AIProvider,
    string
  >;

// Тема по умолчанию — светлая (как arwm.ru); сохранённый выбор приоритетнее.
const defaultSettings: AppSettings = {
  theme: DEFAULT_THEME,
  providerKeys: emptyKeys(),
};

// Ручной выбор темы против загрузки из БД (гонка запросов):
// - choiceSeq растёт при каждом setTheme;
// - seqAtLoadStart — снимок на старте загрузки настроек (loadFromSupabase или
//   bootstrap, который ставит loading: true);
// - syncedSeq — последний выбор, который БД подтвердила.
// Ответ загрузки не перетирает тему, если после её старта был выбор или
// последний выбор ещё не записан в БД.
let choiceSeq = 0;
let seqAtLoadStart = 0;
let syncedSeq = 0;
let themeSync: Promise<void> | null = null;

function markLoadStart() {
  seqAtLoadStart = choiceSeq;
}

function keepLocalTheme(): boolean {
  return choiceSeq !== seqAtLoadStart || syncedSeq !== choiceSeq;
}

export const useSettingsStore = create<SettingsState>()((set, get) => {
  /**
   * Записи темы в БД идут строго по очереди, и каждая шлёт ПОСЛЕДНИЙ выбор:
   * «dark → light» не может закончиться dark, если ответ на dark пришёл позже.
   */
  const flushTheme = (): Promise<void> => {
    if (themeSync) return themeSync;
    if (!get().currentUserId || syncedSeq === choiceSeq) return Promise.resolve();
    const run = async () => {
      try {
        for (;;) {
          const userId = get().currentUserId;
          if (!userId || syncedSeq === choiceSeq) return;
          const seq = choiceSeq;
          try {
            await sbUpsertSettings(userId, { theme: get().settings.theme });
            syncedSeq = seq;
          } catch (e) {
            // Тема не критична — не бросаем; выбор остаётся «неподтверждённым»,
            // загрузка из БД его не перетрёт, следующая загрузка дошлёт его.
            console.warn("[settings] theme sync failed:", e);
            return;
          }
        }
      } finally {
        themeSync = null;
      }
    };
    themeSync = run();
    return themeSync;
  };

  /** Тема из БД — только если пользователь не выбрал свою во время загрузки. */
  const mergeLoaded = (loaded: AppSettings): AppSettings =>
    keepLocalTheme() ? { ...loaded, theme: get().settings.theme } : loaded;

  return {
  settings: defaultSettings,
  analyses: [],
  loading: false,
  loaded: false,
  error: null,
  currentUserId: null,

  loadFromSupabase: async (userId) => {
    markLoadStart();
    set({ loading: true, error: null, currentUserId: userId });
    try {
      const [settings, analyses] = await Promise.all([
        sbGetSettings(userId),
        sbGetAnalyses(userId, 50),
      ]);
      // anthropic_api_key хранится зашифрованным — клиент не должен иметь
      // к нему доступа. Здесь приводим поле к маркеру: либо "configured",
      // либо "" (не настроен).
      const sanitized: AppSettings = settings
        ? {
            theme: settings.theme,
            providerKeys: Object.fromEntries(
              PROVIDER_LIST.map((p) => [
                p,
                settings.providerKeys[p] ? "configured" : "",
              ]),
            ) as Record<AIProvider, string>,
          }
        : defaultSettings;
      set({
        settings: mergeLoaded(sanitized),
        analyses,
        loading: false,
        loaded: true,
        error: null,
      });
    } catch (e) {
      set({
        settings: mergeLoaded(defaultSettings),
        analyses: [],
        loading: false,
        loaded: true,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    void flushTheme();
  },

  hydrate: (userId, settings, analyses) => {
    set({
      settings: mergeLoaded(settings),
      analyses,
      loading: false,
      loaded: true,
      error: null,
      currentUserId: userId,
    });
    // Выбор, сделанный до входа или во время загрузки, — досылаем в БД.
    void flushTheme();
  },

  setApiKey: async (provider, key) => {
    const userId = get().currentUserId;
    if (!userId) throw new Error("Нет активной сессии");
    // Сохраняем через серверный route — он шифрует ключ перед записью
    // в Supabase. Сырой ключ никогда не уходит в БД и не лежит в браузере.
    const res = await fetch("/api/settings/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey: key }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      configured?: boolean;
      verified?: boolean;
      warning?: string;
      error?: string;
    };
    if (!res.ok || !json.ok) {
      throw new Error(json.error ?? `HTTP ${res.status}`);
    }
    // Локально храним только маркер (не сам ключ): "configured" — ключ проверен,
    // "unverified" — сохранён, но проверка не подтвердилась, "" — нет ключа.
    // Оба непустых — truthy (гейт анализа не блокируем), но UI их различает.
    const marker = json.configured
      ? json.verified === false
        ? "unverified"
        : "configured"
      : "";
    set((state) => ({
      settings: {
        ...state.settings,
        providerKeys: {
          ...state.settings.providerKeys,
          [provider]: marker,
        },
      },
    }));
    return { verified: json.verified !== false, warning: json.warning };
  },

  setTheme: async (theme) => {
    choiceSeq += 1;
    set((state) => ({ settings: { ...state.settings, theme } }));
    // Кэш для первой отрисовки без вспышки (класс применяет ThemeInit).
    storeTheme(theme);
    // Без сессии запись дошлёт hydrate/loadFromSupabase после входа.
    await flushTheme();
  },

  addAnalysis: async (a) => {
    const userId = get().currentUserId;
    if (!userId) throw new Error("Нет активной сессии");
    const created = await sbCreateAnalysis(userId, a);
    set((state) => ({
      analyses: [created, ...state.analyses].slice(0, 50),
    }));
    return created;
  },

  removeAnalysis: async (id) => {
    await sbDeleteAnalysis(id);
    set((state) => ({
      analyses: state.analyses.filter((x) => x.id !== id),
    }));
  },

  clearAnalyses: async () => {
    const userId = get().currentUserId;
    if (!userId) throw new Error("Нет активной сессии");
    await sbClearAnalyses(userId);
    set({ analyses: [] });
  },

  reset: () => {
    // Выход: неотправленный выбор темы прежнего пользователя не досылается
    // следующему — после входа тема берётся из его настроек.
    choiceSeq = 0;
    syncedSeq = 0;
    seqAtLoadStart = 0;
    set((state) => ({
      // Тему сохраняем: экран входа после выхода остаётся в выбранной теме.
      settings: { ...defaultSettings, theme: state.settings.theme },
      analyses: [],
      loading: false,
      loaded: false,
      error: null,
      currentUserId: null,
    }));
  },
  };
});

// bootstrap (StoreSync) начинает загрузку, ставя loading: true напрямую, —
// это и есть старт загрузки для защиты ручного выбора темы.
useSettingsStore.subscribe((state, prev) => {
  if (state.loading && !prev.loading) markLoadStart();
});
