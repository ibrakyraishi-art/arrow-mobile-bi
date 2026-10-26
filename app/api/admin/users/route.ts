import { NextResponse } from "next/server";
import { getAdmin, isAdminEmail } from "@/lib/admin";
import { createServiceRoleSupabaseClient } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/**
 * Список пользователей + статистика. Только для админа.
 * Список берём из `profiles` под RLS `is_admin()` — НЕ требует service-role
 * (устойчиво, даже если `SUPABASE_SERVICE_ROLE_KEY` не задан). «Последний вход»
 * (только в auth.users) добираем service-role best-effort — если ключа нет,
 * показываем «—», список всё равно грузится.
 */
export async function GET() {
  try {
    const admin = await getAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: profiles, error } = await admin.supabase
      .from("profiles")
      .select("id, email, full_name, role, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // last_sign_in_at — best-effort через service-role (auth admin API).
    const lastSignIn = new Map<string, string | null>();
    try {
      const svc = createServiceRoleSupabaseClient();
      const perPage = 200;
      for (let page = 1; page <= 50; page++) {
        const { data, error: e } = await svc.auth.admin.listUsers({
          page,
          perPage,
        });
        if (e || !data?.users) break;
        for (const u of data.users) {
          lastSignIn.set(u.id, u.last_sign_in_at ?? null);
        }
        if (data.users.length < perPage) break;
      }
    } catch {
      // service-role не настроен — продолжаем без «последнего входа».
    }

    const users = (profiles ?? []).map((p) => {
      const id = p.id as string;
      const email = (p.email as string | null) ?? "";
      return {
        id,
        email,
        full_name: (p.full_name as string | null) ?? null,
        role: (p.role as string | null) ?? null,
        created_at: p.created_at as string,
        last_sign_in_at: lastSignIn.get(id) ?? null,
        // Защищённые от удаления: сам админ и любой аккаунт с админ-почтой.
        protected: id === admin.user.id || isAdminEmail(email),
      };
    });

    const now = Date.now();
    const newWithin = (days: number) =>
      users.filter((u) => now - new Date(u.created_at).getTime() <= days * DAY)
        .length;
    const active30 = users.filter(
      (u) =>
        u.last_sign_in_at &&
        now - new Date(u.last_sign_in_at).getTime() <= 30 * DAY,
    ).length;

    return NextResponse.json({
      users,
      stats: {
        total: users.length,
        new7: newWithin(7),
        new30: newWithin(30),
        active30,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка загрузки" },
      { status: 500 },
    );
  }
}
