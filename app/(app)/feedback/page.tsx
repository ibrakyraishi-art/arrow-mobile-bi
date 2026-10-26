"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquareWarning, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FEEDBACK_STATUS_META,
  type FeedbackStatus,
} from "@/components/feedback/status";
import { fmtMoscow } from "@/components/feedback/status";

interface MyFeedback {
  id: string;
  message: string;
  page_url: string | null;
  status: FeedbackStatus;
  admin_reply: string | null;
  created_at: string;
  updated_at: string;
  screenshot_url: string | null;
}

export default function MyFeedbackPage() {
  const [items, setItems] = useState<MyFeedback[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/feedback");
      const j = (await res.json()) as { items?: MyFeedback[]; error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setItems(j.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <MessageSquareWarning className="h-5 w-5 text-brand-500" />
              Мои обращения
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Ваши сообщения о проблемах и ответы поддержки.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Обновить
          </Button>
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {items === null ? (
          <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
            Обращений пока нет. Нажмите «Сообщить о проблеме» внизу справа на любой
            странице.
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((f) => {
              const meta = FEEDBACK_STATUS_META[f.status];
              return (
                <div
                  key={f.id}
                  className="rounded-xl border border-border bg-card/40 p-4"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}
                    >
                      {meta.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {fmtMoscow(f.created_at)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-foreground">
                    {f.message}
                  </p>
                  {f.screenshot_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={f.screenshot_url}
                      alt="Скриншот"
                      className="mt-3 max-h-56 rounded-lg border border-border object-contain bg-background"
                    />
                  )}
                  {f.admin_reply && (
                    <div className="mt-3 rounded-lg border border-brand-500/30 bg-brand-500/10 p-3">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-brand-500">
                        Ответ поддержки
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-foreground">
                        {f.admin_reply}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
