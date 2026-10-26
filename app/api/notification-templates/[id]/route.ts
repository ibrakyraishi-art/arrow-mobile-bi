import { NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import { logAudit } from "@/lib/audit";
import {
  normalizeParseMode,
  normalizeParseModeFromOptional,
} from "@/lib/alert-rules-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  name?: string;
  body?: string;
  parseMode?: string;
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch (e) {
    return NextResponse.json(
      { error: "Невалидный JSON", details: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.body === "string") patch.body = body.body;
  const pm = normalizeParseModeFromOptional(body.parseMode);
  if (pm !== null) patch.parse_mode = pm;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Нет полей для обновления" }, { status: 400 });
  }
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("notification_templates")
    .update(patch)
    .eq("id", params.id)
    .select("id, name, body, parse_mode, created_at")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: `Не удалось обновить шаблон: ${error?.message ?? "нет данных"}` },
      { status: 502 },
    );
  }
  return NextResponse.json({
    template: {
      id: data.id,
      name: data.name,
      body: data.body,
      parseMode: normalizeParseMode(data.parse_mode),
      createdAt: data.created_at,
    },
  });
}

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
    .from("notification_templates")
    .delete()
    .eq("id", params.id);
  if (error) {
    return NextResponse.json(
      { error: `Не удалось удалить шаблон: ${error.message}` },
      { status: 502 },
    );
  }
  void logAudit(
    supabase,
    user.id,
    "notification_template_deleted",
    "notification_template",
    params.id,
  );
  return NextResponse.json({ ok: true });
}
