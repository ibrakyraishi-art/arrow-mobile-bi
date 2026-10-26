"use client";

import Link from "next/link";
import { Download, LayoutDashboard, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboardStore } from "@/stores/dashboardStore";
import { DEMO_PLAN_PROJECT_ID } from "@/lib/plan";
import { DEMO_CSV_FILENAME, DEMO_CSV_URL, DEMO_PLAN_DASHBOARD_ID } from "@/lib/demo-data";
import { cn } from "@/lib/utils";

/** Ссылка «Скачать пример CSV» (история 16). */
export function DemoCsvLink({
  className,
  variant = "outline",
}: {
  className?: string;
  variant?: "outline" | "ghost" | "link";
}) {
  return (
    <Button variant={variant} size="sm" className={cn(className)} asChild>
      <a href={DEMO_CSV_URL} download={DEMO_CSV_FILENAME}>
        <Download />
        Скачать пример CSV
      </a>
    </Button>
  );
}

/** Ссылки статьи «Как построить план/факт»: демо-проект, демо-дашборд, CSV. */
export function PlanHelpLinks() {
  const demoDashboard = useDashboardStore((s) =>
    s.dashboards.find((d) => d.id === DEMO_PLAN_DASHBOARD_ID),
  );
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" asChild>
        <Link href={`/plan/${DEMO_PLAN_PROJECT_ID}`}>
          <Target />
          Демо план-проект
        </Link>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <Link href={demoDashboard ? `/dashboards/${demoDashboard.id}` : "/dashboards"}>
          <LayoutDashboard />
          {demoDashboard ? "Демо-дашборд «План/факт»" : "Дашборды (там демо «План/факт»)"}
        </Link>
      </Button>
      <DemoCsvLink />
    </div>
  );
}
