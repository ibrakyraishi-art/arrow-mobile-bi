import { NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/telegram — список Telegram-подключений текущего пользователя.
 * Токен НЕ возвращается, только публичные метаданные.
 */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("telegram_connections")
    .select(
      "id, name, bot_username, chat_id, chat_title, is_verified, last_test_at, last_test_status, last_test_error, created_at",
    )
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: `Не удалось загрузить подключения: ${error.message}` },
      { status: 502 },
    );
  }
  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  return NextResponse.json({
    connections: rows.map((r) => ({
      id: r.id,
      name: r.name,
      botUsername: r.bot_username,
      chatId: r.chat_id,
      chatTitle: r.chat_title,
      isVerified: r.is_verified,
      lastTestAt: r.last_test_at,
      lastTestStatus: r.last_test_status,
      lastTestError: r.last_test_error,
      createdAt: r.created_at,
    })),
  });
}
