import { NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import { logAudit } from "@/lib/audit";
import { calcNextRunAt } from "@/lib/alert-engine";
import {
  normalizeConditions,
  normalizeCreatedBy,
  normalizeModel,
  normalizeSchedule,
  rowToRule,
  ruleToInsert,
} from "@/lib/alert-rules-helpers";
import type { AlertRule } from "@/lib/types";
import { normalizeRuleGroupBy } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateBody {
  name?: string;
  description?: string;
  isActive?: boolean;
  createdBy?: string;
  aiMeta?: AlertRule["aiMeta"];
  datasetId?: string;
  /** Принимаем как массив колонок, так и строку (legacy одно поле). */
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
  analysis?: AlertRule["analysis"];
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("alert_rules")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: `Не удалось загрузить правила: ${error.message}` },
      { status: 502 },
    );
  }
  const rules = ((data as Array<Record<string, unknown>> | null) ?? []).map(
    rowToRule,
  );
  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch (e) {
    return NextResponse.json(
      { error: "Невалидный JSON", details: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  const name = (body.name ?? "").trim();
  const datasetId = (body.datasetId ?? "").trim();
  const groupBy = normalizeRuleGroupBy(body.groupBy);
  // Доставка (бот + шаблон) необязательна на этапе создания — её можно
  // привязать позже во вкладке «Сообщение» / при редактировании правила.
  const telegramConnectionId = (body.telegramConnectionId ?? "").trim();
  const templateId = (body.templateId ?? "").trim();
  const periodDays = Number(body.periodDays);
  if (!name || !datasetId || groupBy.length === 0) {
    return NextResponse.json(
      {
        error: "Заполните название, датасет и группировку (строки).",
      },
      { status: 400 },
    );
  }
  if (!Number.isFinite(periodDays) || periodDays < 1) {
    return NextResponse.json(
      { error: "Период должен быть положительным числом дней" },
      { status: 400 },
    );
  }

  const schedule = normalizeSchedule(body.schedule);
  const conditions = normalizeConditions(body.conditions);
  const nextRunAt = calcNextRunAt(schedule);
  // Без бота+шаблона правило не может слать — создаём его на паузе, чтобы
  // cron не пытался выполнить незавершённое правило.
  const hasDelivery = Boolean(telegramConnectionId && templateId);
  const isActive = hasDelivery && body.isActive !== false;

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("alert_rules")
    .insert(
      ruleToInsert(
        user.id,
        {
          name,
          description: body.description?.trim(),
          isActive,
          createdBy: normalizeCreatedBy(body.createdBy),
          aiMeta: body.aiMeta,
          datasetId,
          groupBy,
          periodDays,
          minSpendFilter:
            typeof body.minSpendFilter === "number"
              ? body.minSpendFilter
              : null,
          conditions,
          telegramConnectionId,
          templateId,
          tagUsers: body.tagUsers?.trim() ?? "",
          useAiRecommendation: body.useAiRecommendation === true,
          aiModel: normalizeModel(body.aiModel),
          schedule,
          analysis: body.analysis,
        },
        nextRunAt,
      ),
    )
    .select("*")
    .single();
  if (error || !data) {
    return NextResponse.json(
      {
        error: `Не удалось создать правило: ${error?.message ?? "нет данных"}`,
      },
      { status: 502 },
    );
  }
  void logAudit(
    supabase,
    user.id,
    "alert_rule_created",
    "alert_rule",
    data.id as string,
    { name },
  );
  return NextResponse.json({ rule: rowToRule(data as Record<string, unknown>) });
}
