import { NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import type { AlertRun } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rowToRun(r: Record<string, unknown>): AlertRun {
  const status =
    r.status === "ok" || r.status === "error" || r.status === "no_match"
      ? r.status
      : "error";
  // Имя правила приходит через JOIN: alert_rules!inner(name)
  const joinedRule = (r.alert_rules as { name?: string } | null) ?? null;
  const aiRec = (r.ai_recommendation as string | null) ?? undefined;
  return {
    id: r.id as string,
    ruleId: (r.rule_id as string) ?? "",
    ruleName: joinedRule?.name ?? "",
    status,
    matchedCount: Number(r.matches_count) || 0,
    matchedObjects: Array.isArray(r.matched_objects)
      ? (r.matched_objects as Array<Record<string, unknown>>)
      : [],
    message: (r.message_sent as string) ?? "",
    aiRecommendation: aiRec,
    usedAi: !!aiRec,
    durationMs: Number(r.duration_ms) || 0,
    errorText: (r.error_text as string | null) ?? undefined,
    createdAt: (r.created_at as string) ?? new Date().toISOString(),
  };
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const ruleId = url.searchParams.get("ruleId");
  const status = url.searchParams.get("status");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const supabase = createServerSupabaseClient();
  // Подтягиваем имя правила через FK alert_runs.rule_id → alert_rules.id.
  let q = supabase
    .from("alert_runs")
    .select("*, alert_rules(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (ruleId) q = q.eq("rule_id", ruleId);
  if (status === "ok" || status === "error" || status === "no_match")
    q = q.eq("status", status);
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lte("created_at", to);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json(
      { error: `Не удалось загрузить историю: ${error.message}` },
      { status: 502 },
    );
  }
  return NextResponse.json({
    runs: ((data as Array<Record<string, unknown>> | null) ?? []).map(rowToRun),
  });
}
