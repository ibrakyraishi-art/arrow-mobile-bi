import { NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import { logAudit } from "@/lib/audit";
import { normalizeParseMode } from "@/lib/alert-rules-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  name?: string;
  body?: string;
  parseMode?: string;
}

function rowToTemplate(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    body: r.body,
    parseMode: normalizeParseMode(r.parse_mode),
    createdAt: r.created_at,
  };
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("notification_templates")
    .select("id, name, body, parse_mode, created_at")
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: `Не удалось загрузить шаблоны: ${error.message}` },
      { status: 502 },
    );
  }
  return NextResponse.json({
    templates: ((data as Array<Record<string, unknown>> | null) ?? []).map(
      rowToTemplate,
    ),
  });
}

export async function POST(request: Request) {
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
  const name = (body.name ?? "").trim();
  const text = (body.body ?? "").trim();
  if (!name || !text) {
    return NextResponse.json(
      { error: "Заполните название и тело шаблона" },
      { status: 400 },
    );
  }
  const supabase = createServerSupabaseClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("notification_templates")
    .insert({
      user_id: user.id,
      name,
      body: text,
      parse_mode: normalizeParseMode(body.parseMode),
      created_at: nowIso,
    })
    .select("id, name, body, parse_mode, created_at")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: `Не удалось создать шаблон: ${error?.message ?? "нет данных"}` },
      { status: 502 },
    );
  }
  void logAudit(
    supabase,
    user.id,
    "notification_template_created",
    "notification_template",
    data.id as string,
  );
  return NextResponse.json({ template: rowToTemplate(data) });
}
