"use client";

import Link from "next/link";
import type { Visualization } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  BarChart3,
  LineChart as LineIcon,
  MoreVertical,
  PieChart as PieIcon,
  TableProperties,
  Trash2,
  Pencil,
  AreaChart,
  ChartBarDecreasing,
  ChartNoAxesCombined,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useDatasetStore } from "@/stores/datasetStore";

const TYPE_ICONS = {
  pivot: TableProperties,
  bar: BarChart3,
  line: LineIcon,
  pie: PieIcon,
  area: AreaChart,
  // Комбо и прогресс — типы плана/факта (рендер — ChartRenderer).
  combo: ChartNoAxesCombined,
  progress: ChartBarDecreasing,
};

export const VIZ_TYPE_LABELS: Record<string, string> = {
  pivot: "Сводная таблица",
  bar: "Столбцы",
  line: "Линии",
  pie: "Круговая",
  area: "Области",
  combo: "Комбо",
  progress: "Прогресс",
};

interface Props {
  viz: Visualization;
  onDelete: (v: Visualization) => void;
}

export function VisualizationCard({ viz, onDelete }: Props) {
  const dataset = useDatasetStore((s) => s.getDataset(viz.datasetId));
  const Icon = TYPE_ICONS[viz.type];

  return (
    <Card className="group relative overflow-hidden transition-all hover:border-primary/30 hover:shadow-xl">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="relative h-32 overflow-hidden border-b border-border bg-gradient-to-br from-muted/40 to-muted/10">
        <div className="absolute inset-0 bg-grid-pattern opacity-10 [background-size:24px_24px]" />
        <div className="relative flex h-full items-center justify-center">
          <Icon className="h-14 w-14 text-muted-foreground/40 transition-colors group-hover:text-primary/70" />
        </div>
      </div>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{viz.name}</h3>
            <p className="text-xs text-muted-foreground truncate">
              {VIZ_TYPE_LABELS[viz.type] ?? viz.type} · {dataset?.name ?? "—"}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/visualization/${viz.id}`}>
                  <Pencil className="h-3.5 w-3.5" />
                  Открыть
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(viz)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">
          {formatDate(viz.createdAt)}
        </div>
      </CardContent>
    </Card>
  );
}
