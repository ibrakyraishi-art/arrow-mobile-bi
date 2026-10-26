import { NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import { friendlyClickhouseError } from "@/lib/data-source-server";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { executeQuery, type QueryBody } from "@/lib/query-engine-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Исполнение запросов визуализаций и виджетов. Вся логика — в общем движке
 * (`lib/query-engine.ts` + `lib/query-engine-server.ts`), его же использует
 * сводка плана. Тело — `QueryBody`; `plan?: PlanContext` дозаполняет
 * виртуальные колонки плана, без него поведение прежнее.
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(
    `query:${user.id}`,
    RATE_LIMITS.QUERY.limit,
    RATE_LIMITS.QUERY.windowMs,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      },
    );
  }

  try {
    const body = (await request.json()) as QueryBody;
    const out = await executeQuery(body, {
      supabase: createServerSupabaseClient,
      today: new Date(),
    });
    return out.status === 200
      ? NextResponse.json(out.body)
      : NextResponse.json(out.body, { status: out.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: friendlyClickhouseError(msg) },
      { status: 500 },
    );
  }
}
