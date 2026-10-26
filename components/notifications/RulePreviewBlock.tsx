"use client";

import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import type { TelegramParseMode } from "@/lib/types";
import { TemplatePreview } from "./template-helpers";

interface PreviewResult {
  status: "ok" | "error" | "no_match";
  matchedCount: number;
  matchedObjects: Array<Record<string, unknown>>;
  message: string;
  errorText?: string;
}

/**
 * Кнопка «Превью» + результат: считает кол-во матчей и рендерит финальный
 * текст сообщения по реальным данным датасета (dry-run, ничего в Telegram
 * не уходит). Используется в RuleEditor, чтобы байер видел, что ловит
 * правило до сохранения.
 */
export function RulePreviewBlock({
  buildPayload,
  templateParseMode,
}: {
  buildPayload: () => Record<string, unknown> | null;
  templateParseMode: TelegramParseMode;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const payload = buildPayload();
    if (!payload) return;
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/alert-rules/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(json.result as PreviewResult);
      if (json.result?.status === "error") {
        toast({
          title: "Превью не выполнено",
          description: json.result?.errorText ?? "Ошибка",
          variant: "destructive",
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={run} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="animate-spin" />
              Считаю…
            </>
          ) : (
            <>
              <Eye />
              Превью сообщения
            </>
          )}
        </Button>
        <p className="text-xs text-muted-foreground">
          Прогон правила на свежих данных без отправки в Telegram.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {result && result.status !== "error" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full bg-muted px-2 py-0.5">
              Найдено объектов:{" "}
              <span className="font-mono font-semibold">
                {result.matchedCount}
              </span>
            </span>
            {result.status === "no_match" && (
              <span className="text-muted-foreground">
                По текущим условиям ничего не попало — сообщение не уйдёт.
              </span>
            )}
          </div>

          {result.matchedCount > 0 && (
            <>
              <div className="text-xs text-muted-foreground">
                Так будет выглядеть сообщение в Telegram:
              </div>
              <TemplatePreview
                body={result.message}
                parseMode={templateParseMode}
                values={{}}
              />
            </>
          )}
        </div>
      )}

      {result && result.status === "error" && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {result.errorText ?? "Ошибка"}
        </div>
      )}
    </div>
  );
}
