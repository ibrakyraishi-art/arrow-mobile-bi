import { NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import { rateLimit } from "@/lib/rate-limit";
import { executeRule } from "@/lib/alert-engine";
import {
  normalizeConditions,
  normalizeModel,
  normalizeSchedule,
} from "@/lib/alert-rules-helpers";
import { loadExecuteRuleInput } from "@/lib/alert-execution-setup";
import { normalizeAnalysisConfig, normalizeRuleGroupBy } from "@/lib/types";
import type { AlertRule } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface PreviewBody {
  name?: string;
  description?: string;
  datasetId?: string;
  groupBy?: string | string[];
  periodDays?: number;
  minSpendFilter?: number | null;
  conditions?: unknown;
  telegramConnectionId?: string;
  templateId?: string;
  tagUsers?: string;
  useAiRecommendation?: boolean;
  aiModel?: string;
  schedule?: unknown;
  analysis?: unknown;
  /** true — реально отправить в Telegram («Тест в Telegram»), без записи в историю. */
  send?: boolean;
}

/**
 * Превью правила: считает матчи и рендерит шаблон. По умолчанию — dry-run
 * (в Telegram ничего не уходит). При `send: true` реально отправляет
 * сообщение (тест), но НЕ пишет в alert_runs. Правило может ещё не
 * существовать в БД.
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`alert-preview:${user.id}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  let body: PreviewBody;
  try {
    body = (await request.json()) as PreviewBody;
  } catch (e) {
    return NextResponse.json(
      { error: "Невалидный JSON", details: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  const datasetId = (body.datasetId ?? "").trim();
  const groupBy = normalizeRuleGroupBy(body.groupBy);
  const telegramConnectionId = (body.telegramConnectionId ?? "").trim();
  const templateId = (body.templateId ?? "").trim();
  const periodDays = Number(body.periodDays);

  const wantSend = body.send === true;

  // Для превью таблицы достаточно датасета, группировки и периода —
  // Telegram-подключение и шаблон не обязательны (в Telegram ничего не уходит).
  // Для реальной отправки (send) подключение и шаблон обязательны.
  const missing: string[] = [];
  if (!datasetId) missing.push("датасет");
  if (groupBy.length === 0) missing.push("группировку");
  if (!Number.isFinite(periodDays) || periodDays < 1)
    missing.push("период (положительное число)");
  if (wantSend && !telegramConnectionId) missing.push("Telegram-подключение");
  if (wantSend && !templateId) missing.push("шаблон");
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Сначала заполните: ${missing.join(", ")}.` },
      { status: 400 },
    );
  }

  const schedule = normalizeSchedule(body.schedule);
  const conditions = normalizeConditions(body.conditions);

  const supabase = createServerSupabaseClient();

  // Собираем синтетический rule-объект — id заглушка, в БД ничего не пишем.
  const rule: AlertRule = {
    id: "preview",
    name: body.name?.trim() || "Превью",
    description: body.description?.trim(),
    isActive: true,
    createdBy: "manual",
    datasetId,
    groupBy,
    periodDays,
    minSpendFilter:
      typeof body.minSpendFilter === "number" ? body.minSpendFilter : undefined,
    conditions,
    telegramConnectionId,
    templateId,
    tagUsers: body.tagUsers?.trim() ?? "",
    useAiRecommendation: body.useAiRecommendation === true,
    aiModel: normalizeModel(body.aiModel),
    schedule,
    analysis: normalizeAnalysisConfig(body.analysis),
    createdAt: new Date().toISOString(),
  };

  const prep = await loadExecuteRuleInput(supabase, rule, {
    userId: user.id,
    userEmail: user.email ?? "",
    allowMissingDelivery: !wantSend,
  });
  if (!prep.ok) {
    const st = prep.error.includes("не найден") ? 404 : 502;
    return NextResponse.json({ error: prep.error }, { status: st });
  }

  // send → реальная отправка (dryRun:false); иначе dry-run превью.
  const result = await executeRule(supabase, {
    ...prep.input,
    dryRun: !wantSend,
  });

  return NextResponse.json({ result });
}
