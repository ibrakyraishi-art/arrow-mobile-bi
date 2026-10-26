import { NextResponse } from "next/server";
import { getAdmin, isAdminEmail } from "@/lib/admin";
import { createServiceRoleSupabaseClient } from "@/lib/server-auth";
import { FEEDBACK_BUCKET } from "@/lib/feedback-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Удаление пользователя (необратимо). Только админ. Требует service-role
 * (`auth.admin.deleteUser`). Все данные удаляются по FK `ON DELETE CASCADE`;
 * скриншоты в Storage чистятся явно. Нельзя удалить себя и учётку с админ-почтой.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const admin = await getAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const id = params.id;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
    }
    if (id === admin.user.id) {
      return NextResponse.json(
        { error: "Нельзя удалить собственный аккаунт" },
        { status: 400 },
      );
    }

    let svc;
    try {
      svc = createServiceRoleSupabaseClient();
    } catch {
      return NextResponse.json(
        {
          error:
            "Удаление недоступно: на сервере не задан SUPABASE_SERVICE_ROLE_KEY.",
        },
        { status: 500 },
      );
    }

    // Доп. защита: не удалять учётку с админ-почтой.
    const { data: target } = await svc.auth.admin.getUserById(id);
    if (!target?.user) {
      return NextResponse.json(
        { error: "Пользователь не найден" },
        { status: 404 },
      );
    }
    if (isAdminEmail(target.user.email)) {
      return NextResponse.json(
        { error: "Нельзя удалить администратора" },
        { status: 400 },
      );
    }

    // 1) Чистим скриншоты пользователя (FK их не каскадит).
    try {
      const { data: objs } = await svc.storage
        .from(FEEDBACK_BUCKET)
        .list(id, { limit: 1000 });
      if (objs && objs.length > 0) {
        await svc.storage
          .from(FEEDBACK_BUCKET)
          .remove(objs.map((o) => `${id}/${o.name}`));
      }
    } catch {
      /* не критично */
    }

    // 1.5) Чистим журнал действий пользователя ПОЛНОСТЬЮ. FK на audit_log —
    // ON DELETE SET NULL, т.е. иначе остались бы обезличенные записи с
    // метаданными (именами его источников и т.п.). Удаляем, чтобы НИЧЕГО не
    // осталось. Делаем ДО deleteUser, пока user_id ещё проставлен.
    try {
      await svc.from("audit_log").delete().eq("user_id", id);
    } catch {
      /* не критично */
    }

    // 2) Удаляем пользователя — остальные БД-данные каскадятся по FK.
    const { error } = await svc.auth.admin.deleteUser(id);
    if (error) {
      return NextResponse.json(
        { error: error.message || "Не удалось удалить пользователя" },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка удаления" },
      { status: 500 },
    );
  }
}
