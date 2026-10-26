import { NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/datasets — серверный листинг датасетов текущего пользователя
 * через RLS Supabase-клиента. Используется для диагностики (видимый блок
 * на странице создания визуализации) — показывает, что сервер реально
 * видит для этой сессии. Параллельный путь к клиентскому
 * `lib/supabase-db::getDatasets`, который дёргает `/datasets`-страница.
 *
 * Структура ошибочного ответа: `{ error, details, step }`,
 * где step ∈ { "auth" | "query" | "parse" }.
 * Пустой результат (нет датасетов) — НЕ ошибка, возвращается `{ datasets: [], count: 0 }`.
 */
export async function GET() {
  let step: "auth" | "query" | "parse" = "auth";
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      console.error(
        "[datasets-list] step=auth status=401 reason=no_session",
      );
      return NextResponse.json(
        { error: "Unauthorized", step: "auth" },
        { status: 401 },
      );
    }

    step = "query";
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("datasets")
      .select("id, name, data_source_id, table_name, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      const details = error.message;
      console.error(
        `[datasets-list] step=query status=502 user=${user.id} details=${details}`,
      );
      return NextResponse.json(
        {
          error: `Не удалось загрузить датасеты: ${details}`,
          details,
          step: "query",
        },
        { status: 502 },
      );
    }

    step = "parse";
    const rows = data ?? [];
    console.log(
      `[datasets-list] status=200 user=${user.id} count=${rows.length}`,
    );

    return NextResponse.json({
      datasets: rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        dataSourceId: r.data_source_id as string,
        table: (r.table_name as string | null) ?? null,
        createdAt: r.created_at as string,
      })),
      count: rows.length,
      userId: user.id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[datasets-list] step=${step} status=500 details=${msg}`,
    );
    return NextResponse.json(
      { error: `Внутренняя ошибка: ${msg}`, details: msg, step },
      { status: 500 },
    );
  }
}
