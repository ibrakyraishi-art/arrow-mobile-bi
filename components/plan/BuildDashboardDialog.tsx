"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutDashboard, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useDashboardStore } from "@/stores/dashboardStore";
import type { Dataset, PlanProject } from "@/lib/types";
import { planDashboardTarget } from "@/lib/plan";
import { DEMO_PLAN_DASHBOARD_ID, DEMO_SAVE_HINT, DEMO_SAVE_HINT_HREF } from "@/lib/demo-data";
import { findPlanDashboard, savePlanDashboard } from "./build-dashboard";
import { DemoCsvLink } from "./DemoLinks";
import { errorText } from "./plan-ui";

const NO_BREAKDOWN = "__none__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: PlanProject;
  dataset: Dataset | undefined;
}

/**
 * «Собрать дашборд план/факт» (история 33): опциональный разрез →
 * `buildPlanDashboard` → сохранение через сторы → переход в дашборд.
 * Повтор: открыть собранный или создать копию.
 */
export function BuildDashboardDialog({ open, onOpenChange, project, dataset }: Props) {
  const dashboards = useDashboardStore((s) => s.dashboards);
  const router = useRouter();
  const { toast } = useToast();
  const [breakdown, setBreakdown] = useState(NO_BREAKDOWN);
  const [busy, setBusy] = useState(false);
  const [forceNew, setForceNew] = useState(false);

  useEffect(() => {
    if (open) {
      setBreakdown(NO_BREAKDOWN);
      setForceNew(false);
    }
  }, [open]);

  // Найти собранный — только при открытом диалоге (читает localStorage).
  const existing = useMemo(
    () => (open ? findPlanDashboard(project, dashboards) : undefined),
    [open, project, dashboards],
  );

  const breakdownColumns = useMemo(
    () =>
      (dataset?.columns ?? []).filter(
        (c) =>
          c.enabled !== false &&
          c.name !== project.dateColumn &&
          (c.datasetType === "string" || c.datasetType === "category"),
      ),
    [dataset, project.dateColumn],
  );

  const showChoice = Boolean(existing) && !forceNew;
  // На демо-датасете шаблон не сохранить (графики в БД ссылаются на датасет
  // по uuid) — ведём в готовый демо-дашборд и объясняем, как собрать свой.
  const onDemo = planDashboardTarget(project).kind === "demo";

  async function build(asCopy: boolean) {
    if (!dataset || onDemo) return;
    setBusy(true);
    try {
      const created = await savePlanDashboard(project, dataset, {
        breakdownColumn: breakdown === NO_BREAKDOWN ? undefined : breakdown,
        name: asCopy ? `План/факт: ${project.name} (копия)` : undefined,
      });
      toast({ title: "Дашборд план/факт собран", variant: "success" });
      onOpenChange(false);
      router.push(`/dashboards/${created.id}`);
    } catch (e) {
      toast({ title: "Не удалось собрать дашборд", description: errorText(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Дашборд план/факт</DialogTitle>
          <DialogDescription>
            Шаблон в один клик: карточки выполнения со светофором и прогнозом, полосы выполнения
            по полям, «факт по дням против плана» и сводная за месяц. Дальше его можно править как
            обычный дашборд.
          </DialogDescription>
        </DialogHeader>

        {onDemo ? (
          <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div className="flex items-start gap-3">
              <LayoutDashboard className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                На демо-данных дашборд уже собран — демо-дашборд «План/факт». {DEMO_SAVE_HINT}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={DEMO_SAVE_HINT_HREF}>Загрузить CSV как источник</Link>
              </Button>
              <DemoCsvLink />
            </div>
          </div>
        ) : !dataset ? (
          <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
            Датасет проекта недоступен — собрать дашборд не из чего.
          </p>
        ) : project.fields.length === 0 ? (
          <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
            Сначала добавьте хотя бы одно поле плана.
          </p>
        ) : showChoice && existing ? (
          <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <LayoutDashboard className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              Дашборд уже собран: <span className="font-medium">{existing.name}</span>. Открыть его
              или собрать новую копию по текущим полям плана?
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label>Разрез (необязательно)</Label>
            <Select value={breakdown} onValueChange={setBreakdown}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_BREAKDOWN}>Без разреза</SelectItem>
                {breakdownColumns.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              С разрезом (клиент, канал) добавится лист «Разрезы»: факт и доля по значениям.
              План там общий на проект.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          {onDemo ? (
            <Button
              onClick={() => {
                onOpenChange(false);
                router.push(`/dashboards/${DEMO_PLAN_DASHBOARD_ID}`);
              }}
            >
              Открыть демо-дашборд
            </Button>
          ) : showChoice && existing ? (
            <>
              <Button variant="outline" onClick={() => setForceNew(true)} disabled={busy}>
                Создать копию
              </Button>
              <Button
                onClick={() => {
                  onOpenChange(false);
                  router.push(`/dashboards/${existing.id}`);
                }}
              >
                Открыть
              </Button>
            </>
          ) : (
            <Button
              variant="gradient"
              onClick={() => void build(Boolean(existing))}
              disabled={busy || !dataset || project.fields.length === 0}
            >
              {busy && <Loader2 className="animate-spin" />}
              Собрать дашборд
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
