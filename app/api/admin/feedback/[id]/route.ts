import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["new", "in_progress", "resolved"];
const MAX_REPLY = 5000;

/** Сменить статус и/или написать ответ на обращение. Только админ. */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const admin = await getAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: { status?: unknown; admin_reply?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !STATUSES.includes(body.status)) {
        return NextResponse.json({ error: "Неверный статус" }, { status: 400 });
      }
      patch.status = body.status;
    }
    if (body.admin_reply !== undefined) {
      if (typeof body.admin_reply !== "string") {
        return NextResponse.json({ error: "Неверный ответ" }, { status: 400 });
      }
      patch.admin_reply = body.admin_reply.slice(0, MAX_REPLY);
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Нечего обновлять" }, { status: 400 });
    }

    // RLS `feedback_update` (is_admin) разрешает только админу.
    const { data, error } = await admin.supabase
      .from("feedback")
      .update(patch)
      .eq("id", params.id)
      .select("id, status, admin_reply, updated_at")
      .single();
    if (error) {
      return NextResponse.json(
        { error: error.message || "Не удалось обновить" },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, item: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка обновления" },
      { status: 500 },
    );
  }
}
