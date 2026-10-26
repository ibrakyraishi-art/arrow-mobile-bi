import { NextResponse } from "next/server";
import { fetchColumns, fetchPreview, runClickhouseQuery } from "@/lib/clickhouse";
import {
  DEMO_COLUMNS,
  DEMO_SOURCE_ID,
  getDemoPreview,
} from "@/lib/demo-data";
import { loadFileSource } from "@/lib/file-source-server";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import {
  CLICKHOUSE_STRUCTURE_QUERY_TIMEOUT_MS,
  friendlyClickhouseError,
} from "@/lib/clickhouse-errors";
import { resolveDataSource } from "@/lib/data-source-server";
import {
  containsDangerousSQL,
  validateTableName,
} from "@/lib/sql-validator";
import type { ColumnInfo, QueryResultRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  isDemo?: boolean;
  table: string | null;
  sqlQuery?: string | null;
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const authedUser = await getAuthenticatedUser();
  if (!authedUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const isDemo = params.id === DEMO_SOURCE_ID || body.isDemo;
  if (isDemo) {
    const table = body.table ?? "campaigns";
    const cols = DEMO_COLUMNS[table] ?? [];
    const preview = getDemoPreview(table, 100);
    return NextResponse.json({ columns: cols, preview });
  }

  if (body.table && !validateTableName(body.table)) {
    return NextResponse.json(
      { error: "Недопустимое имя таблицы" },
      { status: 400 },
    );
  }
  if (body.sqlQuery && containsDangerousSQL(body.sqlQuery)) {
    return NextResponse.json(
      { error: "Запрос содержит запрещённые операции" },
      { status: 400 },
    );
  }

  const supabase = createServerSupabaseClient();

  // Файловый источник: столбцы и превью берём из сохранённых данных.
  const fileSrc = await loadFileSource(supabase, params.id);
  if (fileSrc) {
    return NextResponse.json({
      columns: fileSrc.columns,
      preview: fileSrc.rows.slice(0, 100),
    });
  }

  const resolved = await resolveDataSource(supabase, params.id);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const creds = resolved.creds;

  try {
    let columns: ColumnInfo[] = [];
    let preview: QueryResultRow[] = [];

    if (body.sqlQuery) {
      const sub = `(${body.sqlQuery.trim().replace(/;$/, "")})`;
      const colRes = await runClickhouseQuery(
        creds,
        `SELECT name, type FROM (DESCRIBE ${sub})`,
        { timeoutMs: CLICKHOUSE_STRUCTURE_QUERY_TIMEOUT_MS },
      );
      if (!colRes.ok) throw new Error(colRes.error);
      const parsed = JSON.parse(colRes.data) as {
        data: ColumnInfo[];
      };
      columns = parsed.data;

      const prevRes = await runClickhouseQuery(
        creds,
        `SELECT * FROM ${sub} LIMIT 100`,
      );
      if (!prevRes.ok) throw new Error(prevRes.error);
      preview = (JSON.parse(prevRes.data) as { data: QueryResultRow[] }).data;
    } else if (body.table) {
      columns = await fetchColumns(creds, body.table, {
        timeoutMs: CLICKHOUSE_STRUCTURE_QUERY_TIMEOUT_MS,
      });
      preview = await fetchPreview(creds, body.table, 100);
    }

    return NextResponse.json({ columns, preview });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: friendlyClickhouseError(msg, {
          tableName: body.table ?? undefined,
        }),
      },
      { status: 502 },
    );
  }
}
