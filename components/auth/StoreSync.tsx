"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { useDataSourceStore } from "@/stores/dataSourceStore";
import { useDatasetStore } from "@/stores/datasetStore";
import { useVisualizationStore } from "@/stores/visualizationStore";
import { useDashboardStore } from "@/stores/dashboardStore";
import { useAiProjectStore } from "@/stores/aiProjectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getSupabaseBrowserClient, type Profile } from "@/lib/supabase";
import type {
  AIAnalysis,
  AIProject,
  AppSettings,
  Dashboard,
  DataSource,
  Dataset,
  Visualization,
} from "@/lib/types";

type ApplyAuthExtras = (profile: Profile | null, isAdmin: boolean) => void;

interface BootstrapResponse {
  dataSources: DataSource[];
  datasets: Dataset[];
  visualizations: Visualization[];
  dashboards: Dashboard[];
  aiProjects: AIProject[];
  analyses: AIAnalysis[];
  settings: AppSettings;
  profile: Profile | null;
  isAdmin: boolean;
}

// Прямые загрузки по одному стору — медленный, но надёжный фолбэк, если
// серверный bootstrap недоступен (worst case = прежнее поведение).
function loadEachStore(uid: string) {
  void useDataSourceStore.getState().loadFromSupabase(uid);
  void useDatasetStore.getState().loadFromSupabase(uid);
  void useVisualizationStore.getState().loadFromSupabase(uid);
  void useDashboardStore.getState().loadFromSupabase(uid);
  void useAiProjectStore.getState().loadFromSupabase(uid);
  void useSettingsStore.getState().loadFromSupabase(uid);
}

// Фолбэк для профиля и признака админа, если bootstrap не сработал: прямые
// запросы из браузера (как раньше). Медленнее, но функциональность цела.
async function loadAuthExtrasFallback(uid: string, apply: ApplyAuthExtras) {
  try {
    const supabase = getSupabaseBrowserClient();
    const [profRes, adminRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      fetch("/api/admin/check")
        .then((r) => r.json())
        .catch(() => ({})),
    ]);
    apply(
      (profRes.data as Profile | null) ?? null,
      Boolean((adminRes as { isAdmin?: boolean })?.isAdmin),
    );
  } catch {
    /* профиль не критичен для рендера — игнорируем */
  }
}

// Один серверный запрос (/api/bootstrap) вместо ~8 трансграничных обращений
// к Supabase из браузера: Vercel ↔ Supabase внутри ЕС — быстро, без РФ-
// троттлинга и CORS-preflight. Так первый заход не «висит».
async function bootstrap(uid: string, applyAuthExtras: ApplyAuthExtras) {
  // Сразу показываем индикатор загрузки на вкладках (на случай смены
  // пользователя без полного reset).
  useDataSourceStore.setState({ loading: true });
  useDatasetStore.setState({ loading: true });
  useVisualizationStore.setState({ loading: true });
  useDashboardStore.setState({ loading: true });
  useAiProjectStore.setState({ loading: true });
  useSettingsStore.setState({ loading: true });

  try {
    const res = await fetch("/api/bootstrap", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as BootstrapResponse;
    if (!data?.settings) throw new Error("Пустой ответ bootstrap");

    useDataSourceStore.getState().hydrate(uid, data.dataSources ?? []);
    useDatasetStore.getState().hydrate(uid, data.datasets ?? []);
    useVisualizationStore.getState().hydrate(uid, data.visualizations ?? []);
    useDashboardStore.getState().hydrate(uid, data.dashboards ?? []);
    useAiProjectStore.getState().hydrate(uid, data.aiProjects ?? []);
    useSettingsStore.getState().hydrate(uid, data.settings, data.analyses ?? []);
    // Профиль и признак админа — из того же ответа, без отдельных запросов.
    applyAuthExtras(data.profile ?? null, Boolean(data.isAdmin));
  } catch {
    // Любая ошибка → откатываемся на прямые загрузки, чтобы не потерять
    // функциональность (худший случай — прежнее медленное поведение).
    loadEachStore(uid);
    void loadAuthExtrasFallback(uid, applyAuthExtras);
  }
}

// Keeps Zustand stores in sync with Supabase auth state:
// - On login → серверный bootstrap (с фолбэком на per-store loadFromSupabase).
// - On logout / user change → reset stores back to demo-only defaults.
// Runs once per user id change; component must sit inside <AuthProvider>.
export function StoreSync({ children }: { children: ReactNode }) {
  const { user, applyAuthExtras } = useAuth();
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    const uid = user?.id ?? null;
    if (uid === lastUserId.current) return;
    lastUserId.current = uid;

    if (uid) {
      void bootstrap(uid, applyAuthExtras);
    } else {
      useDataSourceStore.getState().reset();
      useDatasetStore.getState().reset();
      useVisualizationStore.getState().reset();
      useDashboardStore.getState().reset();
      useAiProjectStore.getState().reset();
      useSettingsStore.getState().reset();
    }
    // applyAuthExtras стабилен (useCallback []), на повторные запуски не влияет.
  }, [user?.id, applyAuthExtras]);

  return <>{children}</>;
}
