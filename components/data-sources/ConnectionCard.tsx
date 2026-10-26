"use client";

import { useState } from "react";
import type { DataSource } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "./StatusBadge";
import {
  Database,
  FileSpreadsheet,
  Loader2,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { formatDate, maskHost } from "@/lib/utils";

interface Props {
  source: DataSource;
  onRefresh: (s: DataSource) => void | Promise<void>;
  onDelete: (s: DataSource) => void;
  onEdit: (s: DataSource) => void;
}

export function ConnectionCard({ source, onRefresh, onDelete, onEdit }: Props) {
  const isFile = source.kind === "file";
  const isGsheet = source.fileFormat === "gsheet";
  const [refreshing, setRefreshing] = useState(false);

  async function doRefresh() {
    setRefreshing(true);
    try {
      await onRefresh(source);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Card className="group relative overflow-hidden hover:border-foreground/20 hover:shadow-xl hover:shadow-black/10 transition-all">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      <CardContent className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 border border-brand-500/20">
              {isFile ? (
                <FileSpreadsheet className="h-5 w-5 text-brand-500" />
              ) : (
                <Database className="h-5 w-5 text-brand-500" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold truncate">{source.name}</h3>
              <p className="font-mono text-xs text-muted-foreground truncate">
                {isFile ? "Файл · загруженные данные" : `${maskHost(source.host)}:${source.port}`}
              </p>
              {source.description?.trim() ? (
                <p className="mt-0.5 text-xs text-muted-foreground/80 line-clamp-2">
                  {source.description.trim()}
                </p>
              ) : null}
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(source)}>
                <Pencil className="h-3.5 w-3.5" />
                Изменить
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRefresh(source)}>
                <RefreshCw className="h-3.5 w-3.5" />
                Обновить
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(source)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <StatusBadge status={source.status} />
          <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
            <span>
              {source.tables?.length ?? 0}{" "}
              <span className="text-muted-foreground/60">таблиц</span>
            </span>
          </div>
        </div>

        {/* Google Sheets: режим + ручное обновление (для снимка) */}
        {isGsheet && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
            <div className="min-w-0 text-[11px] text-muted-foreground">
              {source.fileMode === "live" ? (
                <span>
                  <span className="font-medium text-foreground">Живой режим</span>{" "}
                  · по ссылке, без хранения
                </span>
              ) : (
                <span>
                  <span className="font-medium text-foreground">Снимок</span>
                  {source.lastRefreshedAt
                    ? ` · обновлено ${formatDate(source.lastRefreshedAt)}`
                    : ""}
                </span>
              )}
            </div>
            {source.fileMode !== "live" && (
              <Button
                variant="outline"
                size="sm"
                onClick={doRefresh}
                disabled={refreshing}
              >
                {refreshing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Обновить
              </Button>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
          <div className="text-[11px] text-muted-foreground">
            {isFile ? (
              <>Тип: <span className="font-mono text-foreground/80">файл</span></>
            ) : (
              <>
                База:{" "}
                <span className="font-mono text-foreground/80">
                  {source.database}
                </span>
              </>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {formatDate(source.createdAt)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
