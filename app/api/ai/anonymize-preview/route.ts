import { NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import {
  buildValuePairs,
  distinctCount,
  extendAnonState,
  emptyAnonState,
  HIGH_CARDINALITY_THRESHOLD,
  maskRows,
  maskText,
  rowsToCsv,
} from "@/lib/anonymize";
import { loadAnonState } from "@/lib/anonymize-store";
import type { QueryResultRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  projectId?: string;
  rows?: QueryResultRow[];
  confidentialColumns?: string[];
  prompt?: string;
  /** Сколько строк показать в предпросмотре CSV. */
  sampleSize?: number;
}

/**
 * Предпросмотр «что увидит AI»: возвращает образец ЗАМАСКИРОВАННОГО CSV и
 * замаскированный промпт, плюс кардинальность конфиденциальных столбцов.
 * НЕ сохраняет словарь (без side-effect) — для просмотра достаточно эфемерного
 * расширения поверх уже существующего словаря проекта.
 */
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
      { error: e instanceof Error ? e.message : "Invalid body" },
      { status: 400 },
    );
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  const confidential = Array.isArray(body.confidentialColumns)
    ? body.confidentialColumns.filter(
        (c): c is string => typeof c === "string" && c.trim().length > 0,
      )
    : [];

  const sampleSize = Math.min(Math.max(body.sampleSize ?? 20, 1), 100);
  const sampleRows = rows.slice(0, sampleSize);

  // Режим без маскировки (нет помеченных 🔒 полей или нет группировки): показываем
  // сырой срез как есть — именно он и уйдёт в Claude. Без обращения к словарю.
  if (confidential.length === 0) {
    return NextResponse.json({
      maskedCsv: rowsToCsv(sampleRows),
      maskedPrompt: body.prompt ?? "",
      cardinalities: {},
      highCardinalityColumns: [],
      threshold: HIGH_CARDINALITY_THRESHOLD,
      totalRows: rows.length,
      sampleSize: sampleRows.length,
    });
  }

  // Берём существующий словарь проекта (для совпадения кодов с боевым запуском)
  // и расширяем его в памяти — БЕЗ сохранения.
  const supabase = createServerSupabaseClient();
  const prevState = body.projectId
    ? await loadAnonState(supabase, body.projectId)
    : emptyAnonState();
  const { state } = extendAnonState(prevState, rows, confidential);

  const maskedCsv = rowsToCsv(maskRows(sampleRows, confidential, state));

  const pairs = buildValuePairs(state);
  const maskedPrompt = body.prompt ? maskText(body.prompt, pairs) : "";

  const cardinalities: Record<string, number> = {};
  const highCardinalityColumns: string[] = [];
  for (const col of confidential) {
    const n = distinctCount(rows, col);
    cardinalities[col] = n;
    if (n > HIGH_CARDINALITY_THRESHOLD) highCardinalityColumns.push(col);
  }

  return NextResponse.json({
    maskedCsv,
    maskedPrompt,
    cardinalities,
    highCardinalityColumns,
    threshold: HIGH_CARDINALITY_THRESHOLD,
    totalRows: rows.length,
    sampleSize: sampleRows.length,
  });
}
