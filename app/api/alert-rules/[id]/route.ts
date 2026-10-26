import { NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import { logAudit } from "@/lib/audit";
import { calcNextRunAt } from "@/lib/alert-engine";
import {
  normalizeConditions,
  normalizeModel,
  normalizeSchedule,
  rowToRule,
  rulePatchToUpdate,
} from "@/lib/alert-rules-helpers";
import { normalizeRuleGroupBy } from "@/lib/types";
import type { AlertRule } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PatchBody {
  name?: string;
  description?: string;
  isActive?: boolean;
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
  analysis?: AlertRule["analysis"];
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch (e) {
    return NextResponse.json(
      { error: "Невалидный JSON", details: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
  const supabase = createServerSupabaseClient();

  const patch: Parameters<typeof rulePatchToUpdate>[0] = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.description !== undefined) patch.description = body.description?.trim();
  if (body.isActive !== undefined) patch.isActive = body.isActive === true;
  if (body.datasetId !== undefined) patch.datasetId = body.datasetId.trim();
  if (body.groupBy !== undefined)
    patch.groupBy = normalizeRuleGroupBy(body.groupBy);
  if (body.periodDays !== undefined) patch.periodDays = Number(body.periodDays);
  if (body.minSpendFilter !== undefined) {
    // Number("abc")→NaN; не пишем NaN — трактуем нечисло/пусто как «без фильтра».
    const n = body.minSpendFilter === null ? null : Number(body.minSpendFilter);
    patch.minSpendFilter = typeof n === "number" && Number.isFinite(n) ? n : null;
  }
  if (body.conditions !== undefined)
    patch.conditions = normalizeConditions(body.conditions);
  if (body.telegramConnectionId !== undefined)
    patch.telegramConnectionId = body.telegramConnectionId.trim();
  if (body.templateId !== undefined) patch.templateId = body.templateId.trim();
  if (body.tagUsers !== undefined) patch.tagUsers = body.tagUsers.trim();
  if (body.useAiRecommendation !== undefined)
    patch.useAiRecommendation = body.useAiRecommendation === true;
  if (body.aiModel !== undefined) patch.aiModel = normalizeModel(body.aiModel);
  if (body.analysis !== undefined) patch.analysis = body.analysis;
  if (body.schedule !== undefined) {
    patch.schedule = normalizeSchedule(body.schedule);
    patch.nextRunAt = calcNextRunAt(patch.schedule) ?? null;
  }

  const { data, error } = await supabase
    .from("alert_rules")
    .update(rulePatchToUpdate(patch))
    .eq("id", params.id)
    .select("*")
    .single();
  if (error || !data) {
    return NextResponse.json(
      {
        error: `Не удалось обновить правило: ${error?.message ?? "нет данных"}`,
      },
      { status: 502 },
    );
  }
  void logAudit(
    supabase,
    user.id,
    "alert_rule_updated",
    "alert_rule",
    params.id,
  );
  return NextResponse.json({ rule: rowToRule(data as Record<string, unknown>) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("alert_rules")
    .delete()
    .eq("id", params.id);
  if (error) {
    return NextResponse.json(
      { error: `Не удалось удалить правило: ${error.message}` },
      { status: 502 },
    );
  }
  void logAudit(
    supabase,
    user.id,
    "alert_rule_deleted",
    "alert_rule",
    params.id,
  );
  return NextResponse.json({ ok: true });
}
