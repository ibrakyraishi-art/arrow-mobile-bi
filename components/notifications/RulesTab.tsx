"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Copy,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { EmptyState } from "@/components/layout/PageContainer";
import { RuleEditor } from "@/components/notifications/RuleEditor";
import type {
  AlertRule,
  AlertScheduleType,
  NotificationTemplate,
  TelegramConnection,
} from "@/lib/types";
import { formatAlertCondition } from "@/lib/types";

interface Props {
  refreshKey?: number;
  onCreated?: () => void;
}

export function RulesTab({ refreshKey, onCreated }: Props) {
  const { toast } = useToast();
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [connections, setConnections] = useState<TelegramConnection[]>([]);
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [rulesRes, connsRes, tplsRes] = await Promise.all([
        fetch("/api/alert-rules", { cache: "no-store" }),
        fetch("/api/telegram", { cache: "no-store" }),
        fetch("/api/notification-templates", { cache: "no-store" }),
      ]);
      const [rulesJson, connsJson, tplsJson] = await Promise.all([
        rulesRes.json(),
        connsRes.json(),
        tplsRes.json(),
      ]);
      setRules((rulesJson.rules as AlertRule[]) ?? []);
      setConnections((connsJson.connections as TelegramConnection[]) ?? []);
      setTemplates((tplsJson.templates as NotificationTemplate[]) ?? []);
    } catch (e) {
      toast({
        title: "Не удалось загрузить правила",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }, [toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll, refreshKey]);

  function onNewManual() {
    setEditing(null);
    setEditorOpen(true);
  }

  function onEdit(rule: AlertRule) {
    setEditing(rule);
    setEditorOpen(true);
  }

  async function onTogglePause(rule: AlertRule) {
    // Активировать можно только правило с настроенной доставкой.
    if (!rule.isActive && (!rule.telegramConnectionId || !rule.templateId)) {
      toast({
        title: "Сначала настройте доставку",
        description:
          "Привяжите бота и шаблон («Редактировать» → «Сообщение»), потом активируйте.",
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await fetch(`/api/alert-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      await loadAll();
    } catch (e) {
      toast({
        title: "Не удалось изменить статус",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function onDuplicate(rule: AlertRule) {
    try {
      const payload = {
        name: `${rule.name} (копия)`,
        description: rule.description,
        isActive: false,
        createdBy: "manual",
        datasetId: rule.datasetId,
        groupBy: rule.groupBy,
        periodDays: rule.periodDays,
        minSpendFilter: rule.minSpendFilter ?? null,
        conditions: rule.conditions,
        telegramConnectionId: rule.telegramConnectionId,
        templateId: rule.templateId,
        tagUsers: rule.tagUsers,
        schedule: rule.schedule,
        analysis: rule.analysis,
      };
      const res = await fetch("/api/alert-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      toast({ title: "Правило продублировано", variant: "success" });
      await loadAll();
    } catch (e) {
      toast({
        title: "Не удалось дублировать",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function onDelete(rule: AlertRule) {
    if (!confirm(`Удалить правило «${rule.name}»?`)) return;
    try {
      const res = await fetch(`/api/alert-rules/${rule.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      toast({ title: "Правило удалено", variant: "success" });
      await loadAll();
    } catch (e) {
      toast({
        title: "Не удалось удалить",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function onRunNow(rule: AlertRule) {
    setBusyId(rule.id);
    try {
      const res = await fetch(`/api/alert-rules/${rule.id}/run`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const r = json.result as { status: string; matchedCount: number; errorText?: string };
      if (r.status === "ok") {
        toast({
          title: "Отправлено в Telegram",
          description: `Объектов: ${r.matchedCount}`,
          variant: "success",
        });
      } else if (r.status === "no_match") {
        toast({ title: "Нет матчей" });
      } else {
        toast({
          title: "Ошибка выполнения",
          description: r.errorText,
          variant: "destructive",
        });
      }
      await loadAll();
    } catch (e) {
      toast({
        title: "Не удалось запустить",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          Правила запускаются по расписанию (когда будет включён cron) и по
          кнопке «Запустить сейчас». Сейчас доступен только ручной запуск.
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onNewManual}>
            <Plus />
            Создать правило
          </Button>
        </div>
      </div>

      {rules === null ? (
        <Card>
          <CardContent className="flex items-center gap-3 pt-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка…
          </CardContent>
        </Card>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-6 w-6" />}
          title="Нет правил"
          description="Создайте правило на основе своего датасета и KPI."
          action={
            <Button variant="outline" onClick={onNewManual}>
              <Plus />
              Создать правило
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              connections={connections}
              templates={templates}
              busy={busyId === rule.id}
              onRun={() => onRunNow(rule)}
              onEdit={() => onEdit(rule)}
              onTogglePause={() => onTogglePause(rule)}
              onDuplicate={() => onDuplicate(rule)}
              onDelete={() => onDelete(rule)}
            />
          ))}
        </div>
      )}

      <RuleEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        rule={editing}
        connections={connections}
        templates={templates}
        onSaved={() => {
          setEditorOpen(false);
          void loadAll();
          onCreated?.();
        }}
        onTemplatesChanged={() => {
          void loadAll();
        }}
      />
    </div>
  );
}

function RuleCard({
  rule,
  connections,
  templates,
  busy,
  onRun,
  onEdit,
  onTogglePause,
  onDuplicate,
  onDelete,
}: {
  rule: AlertRule;
  connections: TelegramConnection[];
  templates: NotificationTemplate[];
  busy: boolean;
  onRun: () => void;
  onEdit: () => void;
  onTogglePause: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const conn = useMemo(
    () => connections.find((c) => c.id === rule.telegramConnectionId),
    [connections, rule.telegramConnectionId],
  );
  const tpl = useMemo(
    () => templates.find((t) => t.id === rule.templateId),
    [templates, rule.templateId],
  );

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{rule.name}</span>
              {rule.isActive ? (
                <Badge variant="success">Активно</Badge>
              ) : (
                <Badge variant="warning">На паузе</Badge>
              )}
              {(!rule.telegramConnectionId || !rule.templateId) && (
                <Badge
                  variant="outline"
                  className="border-warning/50 text-warning"
                  title="Не задан бот или шаблон — правило не отправляет. Откройте «Редактировать» → «Сообщение»."
                >
                  Нужно сообщение
                </Badge>
              )}
            </div>
            {rule.description && (
              <div className="mt-1 text-sm text-muted-foreground">
                {rule.description}
              </div>
            )}
            <div className="mt-1 text-xs text-muted-foreground">
              {scheduleLabel(rule.schedule.type)} · {scheduleDetails(rule)} ·{" "}
              {rule.schedule.timezone}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span>Датасет: <span className="font-mono">{shortId(rule.datasetId)}</span></span>
              <span>
                Группировка:{" "}
                <span className="font-mono">
                  {Array.isArray(rule.groupBy) && rule.groupBy.length > 0
                    ? rule.groupBy.join(" + ")
                    : "—"}
                </span>
              </span>
              <span>Период: {rule.periodDays} дн.</span>
              {typeof rule.minSpendFilter === "number" && rule.minSpendFilter > 0 && (
                <span>
                  Min spend:{" "}
                  <span className="font-mono">${rule.minSpendFilter}</span>
                </span>
              )}
              <span>Условий: {rule.conditions.length}</span>
              {conn && (
                <span>
                  Бот: <span className="font-mono">@{conn.botUsername}</span>
                </span>
              )}
              {tpl && (
                <span>
                  Шаблон: <span className="font-mono">{tpl.name}</span>
                </span>
              )}
            </div>
            {rule.conditions.length > 0 && (
              <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground/80">
                {rule.conditions.slice(0, 3).map((c, i) => (
                  <div key={i} className="font-mono">
                    • {formatAlertCondition(c)}
                  </div>
                ))}
                {rule.conditions.length > 3 && (
                  <div className="text-muted-foreground/60">
                    …и ещё {rule.conditions.length - 3}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 rounded-md bg-muted/20 p-2 text-xs md:grid-cols-2">
          <div>
            <div className="text-muted-foreground">Last run</div>
            {rule.lastRunAt ? (
              <div>
                {formatDate(rule.lastRunAt)} ·{" "}
                {rule.lastRunStatus === "ok" ? (
                  <span className="text-success">
                    ✓ {rule.lastRunMessage ?? "ok"}
                  </span>
                ) : rule.lastRunStatus === "no_match" ? (
                  <span className="text-muted-foreground">
                    Нет матчей
                  </span>
                ) : (
                  <span className="text-destructive">
                    ✗ {rule.lastRunMessage ?? "ошибка"}
                  </span>
                )}
              </div>
            ) : (
              <div className="text-muted-foreground">—</div>
            )}
          </div>
          <div>
            <div className="text-muted-foreground">Next run</div>
            <div>{rule.nextRunAt ? formatDate(rule.nextRunAt) : "—"}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="gradient"
            size="sm"
            onClick={onRun}
            disabled={busy || !rule.telegramConnectionId || !rule.templateId}
            title={
              !rule.telegramConnectionId || !rule.templateId
                ? "Сначала привяжите бота и шаблон («Редактировать» → «Сообщение»)"
                : undefined
            }
          >
            {busy ? <Loader2 className="animate-spin" /> : <Play />}
            Запустить сейчас
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil />
            Редактировать
          </Button>
          <Button variant="outline" size="sm" onClick={onDuplicate}>
            <Copy />
            Дублировать
          </Button>
          <Button variant="outline" size="sm" onClick={onTogglePause}>
            {rule.isActive ? (
              <>
                <Pause />
                Поставить на паузу
              </>
            ) : (
              <>
                <Wand2 />
                Активировать
              </>
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 />
            Удалить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function scheduleLabel(t: AlertScheduleType): string {
  switch (t) {
    case "daily":
      return "Ежедневно";
    case "weekly":
      return "Еженедельно";
    case "twice_weekly":
      return "Два раза в неделю";
    case "every_n_hours":
      return "Каждые N часов";
    case "trigger_only":
      return "Только по триггеру";
  }
}

function scheduleDetails(rule: AlertRule): string {
  const s = rule.schedule;
  if (s.type === "daily") return s.time ?? "—";
  if (s.type === "every_n_hours")
    return `каждые ${s.intervalHours ?? "?"} ч.`;
  if (s.type === "weekly" || s.type === "twice_weekly") {
    const dayLabels = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
    const days = (s.daysOfWeek ?? []).map((d) => dayLabels[d] ?? "?").join(", ");
    return `${days} в ${s.time ?? "—"}`;
  }
  return "—";
}

function shortId(id: string): string {
  if (!id) return "—";
  if (id.length < 12) return id;
  return id.slice(0, 8) + "…";
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
