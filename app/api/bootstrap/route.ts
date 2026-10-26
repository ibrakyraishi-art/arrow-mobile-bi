import { NextResponse } from "next/server";
import { PROVIDER_LIST, type AIProvider } from "@/lib/ai-models";
import { isAdminEmail } from "@/lib/admin";
import { getAuthenticatedSupabase } from "@/lib/server-auth";
import {
  getAiProjects,
  getAnalyses,
  getDashboards,
  getDataSources,
  getDatasets,
  getUserSettings,
  getVisualizations,
} from "@/lib/supabase-db";
import type { Profile } from "@/lib/supabase";
import type { AppSettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Серверный bootstrap: одним запросом собирает все данные пользователя.
 *
 * Зачем: из браузера (особенно из РФ) каждый запрос к supabase.co — это
 * медленный трансграничный round-trip с CORS-preflight. На старте таких
 * запросов ~8 (источники, датасеты, визуализации, дашборды, проекты,
 * история, настройки) — отсюда «висит при первом заходе».
 *
 * Здесь все чтения идут с сервера (Vercel ↔ Supabase — внутри ЕС, быстро),
 * под RLS текущего пользователя (cookie-сессия), и отдаются браузеру за
 * ОДИН запрос. Ключ Claude на клиент не возвращается — только маркер.
 */
export async function GET() {
  const { supabase, user } = await getAuthenticatedSupabase();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const uid = user.id;

  try {
    const [
      dataSources,
      datasets,
      visualizations,
      dashboards,
      aiProjects,
      analyses,
      rawSettings,
      profileRes,
    ] = await Promise.all([
      getDataSources(uid, supabase),
      getDatasets(uid, supabase),
      getVisualizations(uid, supabase),
      getDashboards(uid, supabase),
      getAiProjects(uid, supabase),
      getAnalyses(uid, 50, supabase),
      getUserSettings(uid, supabase),
      // Профиль и признак админа — тоже на сервере, чтобы браузер из РФ не
      // делал отдельные трансграничные запросы (/profiles, /admin/check).
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
    ]);

    const profile = (profileRes.data as Profile | null) ?? null;
    const isAdmin = isAdminEmail(user.email);

    // Настройки санитизируем на сервере: зашифрованный ключ НЕ должен
    // попадать в браузер — отдаём только маркер наличия по провайдеру.
    const settings: AppSettings = {
      theme: rawSettings?.theme ?? "light",
      providerKeys: Object.fromEntries(
        PROVIDER_LIST.map((p) => [
          p,
          rawSettings?.providerKeys[p] ? "configured" : "",
        ]),
      ) as Record<AIProvider, string>,
    };

    return NextResponse.json({
      dataSources,
      datasets,
      visualizations,
      dashboards,
      aiProjects,
      analyses,
      settings,
      profile,
      isAdmin,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
