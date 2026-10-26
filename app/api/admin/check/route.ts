import { NextResponse } from "next/server";
import { getAuthenticatedSupabase } from "@/lib/server-auth";
import { isAdminEmail } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Лёгкий признак админа для UI (показать пункт «Админка»). Возвращает только
 * boolean — НЕ источник прав: все админ-данные и действия отдельно защищены
 * проверкой на сервере. Для не-админа просто `{ isAdmin: false }` (не 403).
 */
export async function GET() {
  const { user } = await getAuthenticatedSupabase();
  return NextResponse.json({ isAdmin: !!user && isAdminEmail(user.email) });
}
