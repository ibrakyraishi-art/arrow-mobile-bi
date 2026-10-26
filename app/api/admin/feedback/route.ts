import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/admin";
import { signScreenshot } from "@/lib/feedback-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Все обращения (RLS `is_admin()` отдаёт админу всё) + подписанные скриншоты. */
export async function GET() {
  try {
    const admin = await getAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { data, error } = await admin.supabase
      .from("feedback")
      .select(
        "id, user_id, email, message, page_url, screenshot_path, status, admin_reply, created_at, updated_at",
      )
      .order("created_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const items = await Promise.all(
      (data ?? []).map(async (f) => {
        const { screenshot_path, ...rest } = f as typeof f & {
          screenshot_path: string | null;
        };
        return {
          ...rest,
          screenshot_url: await signScreenshot(screenshot_path),
        };
      }),
    );
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка загрузки" },
      { status: 500 },
    );
  }
}
