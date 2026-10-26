"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { readStoredTheme, storeTheme } from "@/lib/theme";

// useLayoutEffect на клиенте (до отрисовки), useEffect на сервере — без warning.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Единственное место, где применяется тема (класс `dark` на <html>).
 * Header и страница настроек только меняют `settings.theme` в сторе.
 * До загрузки настроек с сервера берём кэш из localStorage — тот же,
 * что прочитал inline-скрипт в <head>, поэтому тема не мигает.
 */
export function ThemeInit() {
  const theme = useSettingsStore((s) => s.settings.theme);
  const loaded = useSettingsStore((s) => s.loaded);
  const restored = useRef(false);

  useIsoLayoutEffect(() => {
    // Первый проход на клиенте: стор ещё с темой по умолчанию — подставляем
    // сохранённый выбор, пока не пришли настройки пользователя. Класс не
    // трогаем: его уже поставил inline-скрипт, следующий проход применит тему.
    if (!restored.current) {
      restored.current = true;
      if (!loaded) {
        const stored = readStoredTheme();
        if (stored && stored !== theme) {
          useSettingsStore.setState((s) => ({
            settings: { ...s.settings, theme: stored },
          }));
          return;
        }
      }
    }
    document.documentElement.classList.toggle("dark", theme === "dark");
    // Кэшируем выбор, загруженный с сервера (ручной выбор пишет setTheme).
    if (loaded) storeTheme(theme);
  }, [theme, loaded]);

  return null;
}
