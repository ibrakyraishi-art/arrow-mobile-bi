import { NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/telegram/[id] — удаление Telegram-подключения. RLS не даст
 * удалить чужое: запрос вернёт `count=0` без ошибки.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("telegram_connections")
    .delete()
    .eq("id", params.id);
  if (error) {
    return NextResponse.json(
      { error: `Не удалось удалить подключение: ${error.message}` },
      { status: 502 },
    );
  }
  void logAudit(
    supabase,
    user.id,
    "telegram_connection_deleted",
    "telegram_connection",
    params.id,
  );
  return NextResponse.json({ ok: true });
}
