import { NextResponse } from "next/server";
import { getAuthenticatedSupabase } from "@/lib/server-auth";
import { createFileDataSource } from "@/lib/supabase-db";
import type { DatasetColumn, QueryResultRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateFileBody {
  name?: string;
  description?: string;
  format?: "csv" | "excel" | "gsheet";
  columns?: { name: string; type: DatasetColumn["datasetType"] }[];
  rows?: QueryResultRow[];
  sourceMeta?: Record<string, unknown>;
  mode?: "snapshot" | "live";
}

/**
 * Создание файлового источника (CSV/Excel/Google Sheets) НА СЕРВЕРЕ.
 *
 * Зачем: из браузера в РФ последовательные вставки в Supabase (источник →
 * file_sources → датасет) — это медленные трансграничные запросы, и любой из
 * них может оборваться («Failed to fetch»), оставив источник без датасета.
 * Здесь все вставки идут с сервера (Vercel ↔ Supabase внутри ЕС — быстро и
 * надёжно), под RLS текущего пользователя, за один запрос из браузера.
 */
export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedSupabase();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: CreateFileBody;
  try {
    body = (await request.json()) as CreateFileBody;
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const { name, description, format, columns, rows, sourceMeta, mode } = body;
  if (
    !name?.trim() ||
    !format ||
    !Array.isArray(columns) ||
    columns.length === 0 ||
    !Array.isArray(rows)
  ) {
    return NextResponse.json(
      { error: "Не хватает данных для создания источника" },
      { status: 400 },
    );
  }

  try {
    const result = await createFileDataSource(
      user.id,
      {
        name: name.trim(),
        description: description?.trim() || undefined,
        format,
        columns,
        rows,
        sourceMeta: sourceMeta ?? {},
        mode: mode ?? "snapshot",
      },
      supabase,
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
