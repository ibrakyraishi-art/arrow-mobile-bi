/**
 * Thin typed wrapper around localStorage.
 * On the server returns undefined, on the client parses JSON safely.
 */

export const STORAGE_KEYS = {
  dataSources: "ai-gomobile.dataSources",
  datasets: "ai-gomobile.datasets",
  visualizations: "ai-gomobile.visualizations",
  aiAnalyses: "ai-gomobile.aiAnalyses",
  settings: "ai-gomobile.settings",
  // Кэш выбранной темы (lib/theme.ts) для отрисовки без вспышки. При выходе
  // НЕ сбрасывается: тема — настройка устройства, экран входа остаётся в ней
  // (settingsStore.reset() тоже сохраняет тему). Источник правды — user_settings.
  theme: "ai-gomobile.theme",
} as const;

export function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

export function clearStorage(): void {
  if (typeof window === "undefined") return;
  for (const key of Object.values(STORAGE_KEYS)) {
    window.localStorage.removeItem(key);
  }
}

export function exportAllStorage(): string {
  const data: Record<string, unknown> = {};
  for (const key of Object.values(STORAGE_KEYS)) {
    data[key] = readStorage(key, null);
  }
  return JSON.stringify(data, null, 2);
}

export function importAllStorage(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    for (const key of Object.values(STORAGE_KEYS)) {
      if (key in parsed) {
        writeStorage(key, parsed[key]);
      }
    }
    return true;
  } catch {
    return false;
  }
}
