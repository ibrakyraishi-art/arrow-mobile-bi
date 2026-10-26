import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { fetchSheetCsv } from "@/lib/google-sheet-server";
import { encrypt } from "@/lib/encryption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  url?: string;
}

/**
 * Принимает ссылку на Google Sheets, возвращает CSV-выгрузку листа.
 * Логика скачивания (только docs.google.com, без SSRF; распознавание закрытого
 * листа/размера) вынесена в `lib/google-sheet-server.ts` и переиспользуется
 * живым режимом и кнопкой «Обновить».
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
  const result = await fetchSheetCsv(cleanUrl);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  // Ссылку отдаём ЗАШИФРОВАННОЙ — клиент сохранит её вместо открытой.
  return NextResponse.json({ csv: result.csv, sheetUrlEnc: encrypt(cleanUrl) });
}
