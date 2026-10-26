"use client";

import Link from "next/link";
import { Sparkles, MoreVertical, Pencil, Copy, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDatasetStore } from "@/stores/datasetStore";
import { formatDate } from "@/lib/utils";
import { resolveModel } from "@/lib/ai-models";
import type { AIProject } from "@/lib/types";

interface Props {
  project: AIProject;
  onDelete: (p: AIProject) => void;
  onDuplicate: (p: AIProject) => void;
}

export function AiProjectCard({ project, onDelete, onDuplicate }: Props) {
  const dataset = useDatasetStore((s) => s.getDataset(project.datasetId));
  const modelInfo = resolveModel(project.model);

  return (
    <Card className="group relative overflow-hidden transition-all hover:border-brand-500/30">
      <CardContent className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-500/20 bg-brand-500/10 text-brand-500">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">{project.name}</h3>
              <p className="truncate text-xs text-muted-foreground">
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
                <Link href={`/ai-analysis/${project.id}`}>
                  <Pencil className="h-3.5 w-3.5" />
                  Открыть
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicate(project)}>
                <Copy className="h-3.5 w-3.5" />
                Дублировать
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(project)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {project.description && (
          <p className="mt-3 line-clamp-1 text-xs text-muted-foreground">
            {project.description}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {dataset && (
            <Badge variant="outline" className="text-[10px]">
              {dataset.name}
            </Badge>
          )}
          <Badge variant="outline" className="border-brand-500/40 text-[10px] text-brand-500">
            {modelInfo.icon} {modelInfo.label}
          </Badge>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
          <Stat label="Запусков" value={project.runCount ?? 0} />
          <Stat
            label="Последний"
            value={project.lastRunAt ? formatDate(project.lastRunAt) : "—"}
          />
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Обновлён {formatDate(project.updatedAt)}</span>
          <Link
            href={`/ai-analysis/${project.id}`}
            className="font-medium text-brand-500 transition-colors hover:text-brand-400"
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
      <div className="font-mono text-sm font-semibold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
