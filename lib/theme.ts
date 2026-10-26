/**
 * Тема интерфейса. Класс `dark` на <html> ставит ТОЛЬКО ThemeInit
 * (и до гидратации — inline-скрипт ниже, чтобы не было вспышки).
 * Источник правды — settingsStore (`settings.theme`, синхронизируется
 * с Supabase); localStorage — лишь кэш выбора для первой отрисовки.
 */
import { STORAGE_KEYS } from "@/lib/storage";

export type ThemeMode = "dark" | "light";

/** Тема по умолчанию — светлая, как на arwm.ru. */
export const DEFAULT_THEME: ThemeMode = "light";

/** Ключ кэша выбранной темы — из общего реестра STORAGE_KEYS. */
export const THEME_STORAGE_KEY = STORAGE_KEYS.theme;

export function readStoredTheme(): ThemeMode | null {
  try {
    // Принимаем и JSON-вид ("\"dark\""): так ключ пишет импорт резервной копии.
    const v = window.localStorage.getItem(THEME_STORAGE_KEY)?.replace(/"/g, "");
    return v === "dark" || v === "light" ? v : null;
  } catch {
    // localStorage недоступен (приватный режим и т.п.) — берём тему по умолчанию.
    return null;
  }
}

export function storeTheme(theme: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Кэш темы не критичен: без него просто будет тема по умолчанию при загрузке.
  }
}

/**
 * Inline-скрипт для <head>: выполняется до гидратации и до первой отрисовки,
 * ставит класс `dark`, если пользователь его выбирал. Без сохранённого
 * выбора — светлая тема (класс не ставится).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});document.documentElement.classList.toggle("dark",!!t&&t.replace(/"/g,"")==="dark");}catch(e){}})();`;

/**
 * Фон для экспорта PNG: фон самого элемента, а если он прозрачный или не
 * вычислился — фон текущей темы (токен --background).
 */
export function exportBackgroundColor(el: Element): string {
  const own = getComputedStyle(el).backgroundColor;
  if (own && own !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(own)) return own;
  const token = getComputedStyle(document.documentElement)
    .getPropertyValue("--background")
    .trim();
  return token ? `hsl(${token})` : getComputedStyle(document.body).backgroundColor;
}
