import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/admin";
import { AdminPanel } from "@/components/admin/AdminPanel";

export const dynamic = "force-dynamic";

/**
 * Серверный гейт: страница админки рендерится ТОЛЬКО для админа (email из
 * проверенной сессии == ADMIN_EMAIL). Не-админ редиректится — это не просто
 * скрытая кнопка. Все данные/действия дополнительно защищены в админ-роутах.
 */
export default async function AdminPage() {
  const admin = await getAdmin();
  if (!admin) redirect("/");
  return <AdminPanel />;
}
