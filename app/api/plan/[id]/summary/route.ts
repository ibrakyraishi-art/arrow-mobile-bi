import { NextResponse } from "next/server";
import {
  createServiceRoleSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getPlanProject } from "@/lib/supabase-db";
import {
  buildPlanSummary,
  demoFactSource,
  planFactSource,
  type FactSourceResult,
} from "@/lib/plan-summary-server";
import { buildDemoPlanProject, isDemoPlanProjectId, moscowMonth } from "@/lib/plan";
import type { PlanProject } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Сводка план-проекта за месяц (Решения §8): итог по полям плана и по дням.
 * Проект, датасет и источник читаются через service role — карточки плана
 * видны всей команде, даже если датасет чужой. Отдаются только агрегаты
 * полей плана, сырые строки — никогда.
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rl = rateLimit(
    `plan-summary:${user.id}`,
    RATE_LIMITS.QUERY.limit,
    RATE_LIMITS.QUERY.windowMs,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const now = new Date();
  const monthParam = new URL(request.url).searchParams.get("month");
  const month = monthParam ?? moscowMonth(now);
  if (!MONTH_RE.test(month)) {
    return NextResponse.json(
      { error: "Месяц должен быть в формате ГГГГ-ММ" },
      { status: 400 },
    );
  }

  // --- Проект и откуда брать факт ------------------------------------------
  let project: PlanProject;
  let factSource: FactSourceResult;
  const service = isDemoPlanProjectId(params.id)
    ? null
    : (() => {
        try {
          return createServiceRoleSupabaseClient();
        } catch {
          return null;
        }
      })();

  if (isDemoPlanProjectId(params.id)) {
    project = buildDemoPlanProject(now);
    factSource = { source: demoFactSource(now) };
  } else {
    if (!service) {
      return NextResponse.json(
        { error: "Сервер не настроен для чтения планов (нет service role)" },
        { status: 500 },
      );
    }
    let found: PlanProject | null;
    try {
      found = await getPlanProject(params.id, service);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
    if (!found) {
      return NextResponse.json({ error: "План-проект не найден" }, { status: 404 });
    }
    project = found;
    factSource = await planFactSource(project, service, now);
  }

  const body = await buildPlanSummary(project, month, factSource, {
    supabase: () => service!,
    now,
  });
  return NextResponse.json(body);
}
