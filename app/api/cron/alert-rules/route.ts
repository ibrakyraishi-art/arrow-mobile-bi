import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  executeRule,
  type ExecuteRuleResult,
} from "@/lib/alert-engine";
import {
  loadExecuteRuleInput,
  persistAlertExecutionResult,
} from "@/lib/alert-execution-setup";
import { rowToRule } from "@/lib/alert-rules-helpers";
import { createServiceRoleSupabaseClient } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Hobby; на Pro можно поднять до 300 см. документацию Vercel. */
export const maxDuration = 60;

interface CronOutcome {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

/**
 * Constant-time сравнение строк. Сравниваем SHA-256-дайджесты (всегда 32
 * байта) — поэтому `timingSafeEqual` не бросает на входах разной длины, а
 * сравнение не утекает по времени. Для совпадающих секретов поведение
 * идентично обычному `===` (рабочую авторизацию не ломает).
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    // Vercel подставляет `Authorization: Bearer $CRON_SECRET`, только если
    // переменная задана в окружении проекта. Без неё крон всегда получит 401.
    console.error(
      "[cron/alert-rules] CRON_SECRET не задан в окружении — крон отклонён (401)",
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const auth = request.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${expected}`)) {
    // Крон ДОШЁЛ до эндпоинта, но секрет не совпал — видно в логах Vercel
    // (значение секрета не логируем).
    console.warn(
      "[cron/alert-rules] неверный Authorization — проверь CRON_SECRET (401)",
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let supabase: ReturnType<typeof createServiceRoleSupabaseClient>;
  try {
    supabase = createServiceRoleSupabaseClient();
  } catch (e) {
    console.error("[cron/alert-rules] Supabase:", e);
    return NextResponse.json(
      {
        error: "Service misconfigured",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 503 },
    );
  }

  const nowIso = new Date().toISOString();
  const { data: rows, error: queryErr } = await supabase
    .from("alert_rules")
    .select("*")
    .eq("is_active", true)
    .lte("next_run_at", nowIso);

  if (queryErr) {
    console.error("[cron/alert-rules] select:", queryErr.message);
    return NextResponse.json(
      { error: `Не удалось загрузить правила: ${queryErr.message}` },
      { status: 502 },
    );
  }

  const rules = rows ?? [];
  const outcome: CronOutcome = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  const userIds = [...new Set(rules.map((r) => r.user_id as string).filter(Boolean))];
  const emailMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles, error: pErr } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", userIds);
    if (pErr) {
      console.warn("[cron/alert-rules] profiles:", pErr.message);
    }
    for (const p of profiles ?? []) {
      const row = p as { id: string; email: string | null };
      emailMap[row.id] = row.email ?? "";
    }
  }

  for (const row of rules) {
    outcome.processed += 1;
    const rule = rowToRule(row as Record<string, unknown>);
    const userId = row.user_id as string;
    const t0 = Date.now();
    let result: ExecuteRuleResult;

    try {
      const prep = await loadExecuteRuleInput(supabase, rule, {
        userId,
        userEmail: emailMap[userId] ?? "",
      });

      if (!prep.ok) {
        result = {
          status: "error",
          matchedCount: 0,
          matchedObjects: [],
          message: "",
          usedAi: false,
          durationMs: Date.now() - t0,
          errorText: prep.error,
        };
      } else {
        try {
          result = await executeRule(supabase, prep.input);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[cron/alert-rules] executeRule throw", rule.id, e);
          result = {
            status: "error",
            matchedCount: 0,
            matchedObjects: [],
            message: "",
            usedAi: false,
            durationMs: Date.now() - t0,
            errorText: msg,
          };
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[cron/alert-rules] iteration error", rule.id, e);
      result = {
        status: "error",
        matchedCount: 0,
        matchedObjects: [],
        message: "",
        usedAi: false,
        durationMs: Date.now() - t0,
        errorText: msg,
      };
    }

    if (result.status === "error") {
      outcome.failed += 1;
      outcome.errors.push(
        `${rule.name} (${rule.id}): ${result.errorText ?? "Ошибка"}`,
      );
    } else {
      outcome.succeeded += 1;
    }

    try {
      await persistAlertExecutionResult(supabase, {
        userId,
        rule,
        result,
        createdAtIso: new Date().toISOString(),
        triggeredBy: "cron",
      });
    } catch (pe) {
      console.error("[cron/alert-rules] persist", rule.id, pe);
    }
  }

  console.log(
    `[cron/alert-rules] processed=${outcome.processed} ok=${outcome.succeeded} fail=${outcome.failed}`,
  );

  return NextResponse.json(outcome);
}
