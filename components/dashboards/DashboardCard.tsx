"use client";

import Link from "next/link";
import { LayoutDashboard, MoreVertical, Pencil, Copy, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDatasetStore } from "@/stores/datasetStore";
import { formatDate } from "@/lib/utils";
import type { Dashboard } from "@/lib/types";

interface Props {
  dashboard: Dashboard;
  onDelete: (d: Dashboard) => void;
  onDuplicate: (d: Dashboard) => void;
}

export function DashboardCard({ dashboard, onDelete, onDuplicate }: Props) {
  const dataset = useDatasetStore((s) => s.getDataset(dashboard.datasetId));
  const sheetsCount = dashboard.sheetsCount ?? dashboard.sheets.length;

  return (
    <Card className="group relative overflow-hidden hover:border-foreground/20 hover:shadow-xl transition-all">
      <div className="absolute inset-0 bg-gradient-to-br from-success/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      <CardContent className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-success/20 to-chart-7/20 border border-success/20">
              <LayoutDashboard className="h-5 w-5 text-success" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold truncate">{dashboard.name}</h3>
              <p className="text-xs text-muted-foreground truncate">
                {dataset?.name ?? "—"}
              </p>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/dashboards/${dashboard.id}`}>
                  <Pencil className="h-3.5 w-3.5" />
                  Открыть
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicate(dashboard)}>
                <Copy className="h-3.5 w-3.5" />
                Дублировать
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(dashboard)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {dashboard.description && (
          <p className="mt-3 text-xs text-muted-foreground line-clamp-2">
            {dashboard.description}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
          <Stat label="Листов" value={sheetsCount} />
          <Stat label="Фильтров" value={dashboard.filtersConfig.length} />
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{formatDate(dashboard.updatedAt ?? dashboard.createdAt)}</span>
          <Link
            href={`/dashboards/${dashboard.id}`}
            className="font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Открыть →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-sm font-semibold font-mono">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
