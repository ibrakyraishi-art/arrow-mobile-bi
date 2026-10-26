import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Лёгкий «прогрев» (keep-warm). Делает тривиальный запрос к БД, чтобы
 * Supabase/Vercel не «засыпали» после простоя и первая загрузка у
 * пользователей не упиралась в холодный старт.
 *
 * Дёргается внешним бесплатным пингером (например, cron-job.org) раз в
 * ~5 минут: GET https://<ваш-домен>/api/ping. Плюс страховка: крон
 * Vercel (vercel.json), чтобы бесплатный Supabase не уходил в паузу,
 * даже если внешний пингер отвалится. Аутентификация не нужна —
 * эндпоинт ничего не отдаёт, кроме { ok } (без данных).
 */
export async function GET() {
  try {
    const supabase = createServiceRoleSupabaseClient();
    // Минимальный запрос — будит соединение/компьют, данных не возвращает.
    await supabase.from("user_settings").select("user_id").limit(1);
    return NextResponse.json({ ok: true, ts: Date.now() });
  } catch {
    // Даже при ошибке отвечаем 200 — пингеру важно, что сервис ответил.
    return NextResponse.json({ ok: false, ts: Date.now() });
  }
}
