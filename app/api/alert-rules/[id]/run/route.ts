import { NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { executeRule } from "@/lib/alert-engine";
import { rowToRule } from "@/lib/alert-rules-helpers";
import {
  DEMO_DATASET_ID_ALERTS,
  loadExecuteRuleInput,
  persistAlertExecutionResult,
} from "@/lib/alert-execution-setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`alert-run:${user.id}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const supabase = createServerSupabaseClient();

  const { data: ruleRow, error: ruleErr } = await supabase
    .from("alert_rules")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (ruleErr) {
    return NextResponse.json(
      { error: `Не удалось загрузить правило: ${ruleErr.message}` },
      { status: 502 },
    );
  }
  if (!ruleRow) {
    return NextResponse.json(
      { error: "Правило не найдено или нет доступа" },
      { status: 404 },
    );
  }
  const rule = rowToRule(ruleRow as Record<string, unknown>);

  const prep = await loadExecuteRuleInput(supabase, rule, {
    userId: user.id,
    userEmail: user.email ?? "",
  });
  if (!prep.ok) {
    const st = prep.error.includes("не найден") ? 404 : 502;
    return NextResponse.json({ error: prep.error }, { status: st });
  }

  console.log(
    `[alert-run] start user=${user.id} rule=${rule.id} dataset=${prep.input.dataset.id} demo=${rule.datasetId === DEMO_DATASET_ID_ALERTS}`,
  );

  const result = await executeRule(supabase, prep.input);

  console.log(
    `[alert-run] done user=${user.id} rule=${rule.id} status=${result.status} matched=${result.matchedCount} ms=${result.durationMs}`,
  );

  const nowIso = new Date().toISOString();
  const { run: runData } = await persistAlertExecutionResult(supabase, {
    userId: user.id,
    rule,
    result,
    createdAtIso: nowIso,
    triggeredBy: "manual",
  });

  void logAudit(
    supabase,
    user.id,
    "alert_rule_run",
    "alert_rule",
    rule.id,
    {
      status: result.status,
      matched: result.matchedCount,
      used_ai: result.usedAi,
    },
  );

  return NextResponse.json({
    result,
    run: runData ?? null,
  });
}
