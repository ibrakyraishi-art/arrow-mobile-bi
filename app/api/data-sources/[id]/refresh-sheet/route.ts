import { NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import { refreshFileSource } from "@/lib/file-source-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Кнопка «Обновить» для источника Google Sheets: принудительно перечитывает
 * таблицу по сохранённой ссылке (минуя 30-минутный интервал автообновления).
 * Доступ к строке file_sources ограничен RLS (только свои источники).
 */
export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseClient();
  const result = await refreshFileSource(supabase, params.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    mode: result.mode,
    rowCount: result.rowCount,
    lastRefreshedAt: result.lastRefreshedAt,
  });
}
