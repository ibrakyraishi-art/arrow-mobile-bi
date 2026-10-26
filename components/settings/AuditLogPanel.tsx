"use client";

import { useEffect, useState } from "react";
import { ScrollText, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import {
  AUDIT_ACTION_LABELS,
  getAuditLog,
  type AuditEntry,
} from "@/lib/audit";

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function detailLabel(entry: AuditEntry): string {
  if (!entry.details) return "";
  const d = entry.details as Record<string, unknown>;
  if (typeof d.name === "string" && d.name) return d.name;
  if (typeof d.model === "string" && d.model) return `модель: ${d.model}`;
  if (entry.resourceId) return entry.resourceId;
  return "";
}

export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAuditLog(getSupabaseBrowserClient(), 20)
      .then((rows) => {
        if (!cancelled) {
          setEntries(rows);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 border border-brand-500/30 text-brand-500">
            <ScrollText className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>Журнал действий</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              Последние 20 событий: вход, изменение настроек, создание и
              удаление сущностей, AI-анализы.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка журнала…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Не удалось загрузить журнал: {error}
            <div className="mt-1 text-xs text-muted-foreground">
              Возможно, таблица <code>audit_log</code> ещё не создана в Supabase.
              Выполните SQL из <code>supabase/schema-audit.sql</code>.
            </div>
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
            Записей пока нет.
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">
                    {AUDIT_ACTION_LABELS[e.action] ?? e.action}
                  </div>
                  {detailLabel(e) && (
                    <div className="font-mono text-xs text-muted-foreground truncate">
                      {detailLabel(e)}
                    </div>
                  )}
                </div>
                <div className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                  {formatDateTime(e.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
