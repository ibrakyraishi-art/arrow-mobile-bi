"use client";

import Link from "next/link";
import type { Dataset } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { LayoutGrid, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { formatDate, formatNumber } from "@/lib/utils";
import { useDataSourceStore } from "@/stores/dataSourceStore";

interface Props {
  dataset: Dataset;
  onDelete: (d: Dataset) => void;
}

export function DatasetCard({ dataset, onDelete }: Props) {
  const source = useDataSourceStore((s) => s.getSource(dataset.dataSourceId));
  const enabledCols = dataset.columns.filter((c) => c.enabled).length;

  // Для файловых источников (Google Sheets / CSV / Excel) техническое имя
  // «таблицы» (FILE_TABLE = "data") бессмысленно — показываем формат источника.
  const sourceDetail =
    source?.kind === "file"
      ? source.fileFormat === "gsheet"
        ? "Google Sheets"
        : source.fileFormat === "excel"
          ? "Excel"
          : source.fileFormat === "csv"
            ? "CSV"
            : "Файл"
      : (dataset.table ?? "custom SQL");

  return (
    <Card className="group relative overflow-hidden hover:border-brand-500/30 transition-colors">
      <CardContent className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 border border-brand-500/20">
              <LayoutGrid className="h-5 w-5 text-brand-500" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold truncate">{dataset.name}</h3>
              <p className="text-xs text-muted-foreground truncate">
                {source?.name ?? "—"} ·{" "}
                <span className="font-mono">{sourceDetail}</span>
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
                <Link href={`/datasets/${dataset.id}`}>
                  <Pencil className="h-3.5 w-3.5" />
                  Редактировать
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(dataset)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
          <Stat label="Столбцов" value={enabledCols} />
          <Stat label="Всего" value={dataset.columns.length} />
          <Stat
            label="Строк"
            value={formatNumber(dataset.rowCount ?? 0)}
          />
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{formatDate(dataset.createdAt)}</span>
          <Link
            href={`/datasets/${dataset.id}`}
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
