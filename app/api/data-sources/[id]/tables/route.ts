import { NextResponse } from "next/server";
import { fetchTables } from "@/lib/clickhouse";
import { DEMO_SOURCE_ID, DEMO_TABLES } from "@/lib/demo-data";
import { loadFileSource, FILE_TABLE } from "@/lib/file-source-server";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import {
  friendlyClickhouseError,
  resolveDataSource,
} from "@/lib/data-source-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLICKHOUSE_TIMEOUT_MS = 15000;

interface Body {
  isDemo?: boolean;
}

type Step = "decrypt_password" | "connect" | "query" | "parse";

function errorResponse(args: {
  step: Step;
  error: string;
  details: string;
  status: number;
  sourceId: string;
}) {
  console.error(
    `[tables-api] step=${args.step} status=${args.status} source=${args.sourceId} details=${args.details}`,
  );
  return NextResponse.json(
    { error: args.error, details: args.details, step: args.step },
    { status: args.status },
  );
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: Body = {};
    try {
      body = (await request.json()) as Body;
    } catch {
      // body опционален
    }

    if (params.id === DEMO_SOURCE_ID || body.isDemo) {
      return NextResponse.json({ tables: DEMO_TABLES });
    }

    const supabase = createServerSupabaseClient();

    // Файловый источник: единственная логическая «таблица».
    const fileSrc = await loadFileSource(supabase, params.id);
    if (fileSrc) {
      return NextResponse.json({
        tables: [
          { name: FILE_TABLE, engine: "file", totalRows: fileSrc.rows.length },
        ],
      });
    }

    const resolved = await resolveDataSource(supabase, params.id);
    if (!resolved.ok) {
      const isDecrypt = /расшифровать|ENCRYPTION_KEY/i.test(resolved.error);
      const step: Step = isDecrypt ? "decrypt_password" : "connect";
      return errorResponse({
        step,
        error: resolved.error,
        details: resolved.error,
        status: resolved.status,
        sourceId: params.id,
      });
    }

    let raw: string;
    try {
      const tables = await fetchTables(resolved.creds, {
        timeoutMs: CLICKHOUSE_TIMEOUT_MS,
      });
      // Пустой результат — это валидный ответ, не ошибка.
      return NextResponse.json({ tables });
    } catch (e) {
      raw = e instanceof Error ? e.message : String(e);
    }

    let step: Step = "connect";
    if (/^parse:/i.test(raw) || /Unexpected token|JSON\.parse/i.test(raw)) {
      step = "parse";
    } else if (/DB::Exception|Code:\s*\d+|Syntax error/i.test(raw)) {
      step = "query";
    } else if (
      /aborted|abort|ENOTFOUND|getaddrinfo|EAI_AGAIN|ECONNREFUSED|ECONNRESET|fetch failed|TLS|certificate|network|\b401\b|Unauthorized|Authentication failed/i.test(
        raw,
      )
    ) {
      step = "connect";
    }

    return errorResponse({
      step,
      error: friendlyClickhouseError(raw),
      details: raw,
      status: 502,
      sourceId: params.id,
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.error(`[tables-api] unexpected error: ${raw}`);
    return NextResponse.json(
      {
        error: `Внутренняя ошибка сервера: ${raw}`,
        details: raw,
        step: "connect" as Step,
      },
      { status: 500 },
    );
  }
}
