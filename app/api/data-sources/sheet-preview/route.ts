import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { fetchSheetXlsx } from "@/lib/google-sheet-server";
import { parseExcelWithTabs } from "@/lib/file-parse";
import { encrypt } from "@/lib/encryption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  url?: string;
  /** Имя выбранной вкладки; если не задано — берётся первая. */
  sheetName?: string;
}

/**
 * Для подключения Google Sheets: скачивает книгу как .xlsx, возвращает список
 * вкладок и разбор выбранной (или первой) — чтобы пользователь мог выбрать лист,
 * когда вкладок несколько. Если xlsx-выгрузка недоступна, клиент откатывается на
 * CSV-выгрузку первого листа (роут /fetch-sheet).
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Невалидный запрос" }, { status: 400 });
  }

  const cleanUrl = (body.url ?? "").trim();
  const x = await fetchSheetXlsx(cleanUrl);
  if (!x.ok) {
    return NextResponse.json({ error: x.error }, { status: x.status });
  }
  try {
    const parsed = await parseExcelWithTabs(x.buf, { sheetName: body.sheetName });
    return NextResponse.json({
      tabs: parsed.tabs,
      sheetName: parsed.sheetName,
      columns: parsed.columns,
      rows: parsed.rows,
      truncated: parsed.truncated,
      // Ссылку отдаём ЗАШИФРОВАННОЙ — клиент сохранит её вместо открытой.
      sheetUrlEnc: encrypt(cleanUrl),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
