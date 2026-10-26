"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageSquareWarning, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

type Phase = "idle" | "selecting" | "capturing" | "form" | "sending";
interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MIN_SIZE = 12;

/**
 * Кнопка «Сообщить о проблеме» (для любого залогиненного пользователя).
 * Поток: выделение прямоугольной области → клиентский снимок этой области DOM
 * (html2canvas) → комментарий → отправка в /api/feedback. Снимок — это рендер
 * DOM видимой области, не системный скриншот.
 */
export function ReportProblemButton() {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const [rect, setRect] = useState<Rect | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setRect(null);
    setShot(null);
    setMessage("");
    dragStart.current = null;
  }, []);

  // Esc отменяет любой активный режим (выделение/форма), кроме момента отправки.
  useEffect(() => {
    if (phase === "idle" || phase === "sending") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, reset]);

  async function captureRegion(r: Rect): Promise<string | null> {
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(document.body, {
        x: window.scrollX + r.left,
        y: window.scrollY + r.top,
        width: r.width,
        height: r.height,
        scale: 1,
        useCORS: true,
        // Фон скриншота — текущий фон темы (светлой или тёмной).
        backgroundColor: getComputedStyle(document.body).backgroundColor || null,
        logging: false,
        ignoreElements: (el) =>
          el instanceof HTMLElement && el.hasAttribute("data-feedback-overlay"),
      });
      return canvas.toDataURL("image/png");
    } catch (e) {
      console.warn("[feedback] screenshot failed", e);
      return null;
    }
  }

  function onMouseDown(e: React.MouseEvent) {
    if (phase !== "selecting") return;
    dragStart.current = { x: e.clientX, y: e.clientY };
    setRect({ left: e.clientX, top: e.clientY, width: 0, height: 0 });
  }
  function onMouseMove(e: React.MouseEvent) {
    if (phase !== "selecting" || !dragStart.current) return;
    const s = dragStart.current;
    setRect({
      left: Math.min(s.x, e.clientX),
      top: Math.min(s.y, e.clientY),
      width: Math.abs(e.clientX - s.x),
      height: Math.abs(e.clientY - s.y),
    });
  }
  async function onMouseUp() {
    if (phase !== "selecting" || !rect || !dragStart.current) return;
    dragStart.current = null;
    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
      // слишком маленькая область — сбрасываем выделение, остаёмся в режиме
      setRect(null);
      return;
    }
    setPhase("capturing");
    const img = await captureRegion(rect);
    setShot(img); // может быть null — тогда отправим без скриншота
    setPhase("form");
  }

  async function submit() {
    const text = message.trim();
    if (!text) {
      toast({ title: "Опишите проблему", variant: "destructive" });
      return;
    }
    setPhase("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          pageUrl: typeof location !== "undefined" ? location.href : null,
          screenshot: shot ?? undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      toast({ title: "Спасибо! Обращение отправлено", variant: "success" });
      reset();
    } catch (e) {
      toast({
        title: "Не удалось отправить",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      setPhase("form");
    }
  }

  return (
    <>
      {/* Кнопка-триггер — компактная, живёт в шапке (Header) */}
      {phase === "idle" && (
        <button
          type="button"
          data-feedback-overlay
          onClick={() => setPhase("selecting")}
          title="Сообщить о проблеме — выделите область с ошибкой и опишите"
          className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/85"
        >
          <MessageSquareWarning className="h-4 w-4" />
          <span className="hidden sm:inline">Сообщить о проблеме</span>
        </button>
      )}

      {/* Режим выделения области */}
      {(phase === "selecting" || phase === "capturing") && (
        <div
          data-feedback-overlay
          className="fixed inset-0 z-[100] cursor-crosshair select-none bg-overlay/35"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
        >
          <div className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 rounded-lg border border-border bg-card/95 px-4 py-2 text-xs text-foreground shadow-lg">
            {phase === "capturing" ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Готовлю
                скриншот…
              </span>
            ) : (
              <>Выделите область с проблемой · Esc — отмена</>
            )}
          </div>
          {rect && (
            <div
              className="pointer-events-none absolute border-2 border-warning bg-warning/10"
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              }}
            />
          )}
          <button
            type="button"
            onClick={reset}
            className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card/95 text-muted-foreground hover:text-foreground"
            aria-label="Отмена"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Форма комментария */}
      {(phase === "form" || phase === "sending") && (
        <div
          data-feedback-overlay
          className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay/55 p-4"
        >
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                Сообщить о проблеме
              </h2>
              <button
                type="button"
                onClick={reset}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {shot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={shot}
                alt="Скриншот области"
                className="mb-3 max-h-48 w-full rounded-lg border border-border object-contain bg-background"
              />
            ) : (
              <p className="mb-3 rounded-lg border border-dashed border-border bg-muted/20 p-2.5 text-[11px] text-muted-foreground">
                Скриншот не получился — можно отправить обращение и без него.
              </p>
            )}

            <textarea
              autoFocus
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={5000}
              placeholder="Опишите, что не так и что ожидали…"
              className="h-28 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand-500/50"
            />

            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={reset} disabled={phase === "sending"}>
                Отмена
              </Button>
              <Button
                variant="gradient"
                size="sm"
                onClick={submit}
                disabled={phase === "sending" || !message.trim()}
              >
                {phase === "sending" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "Отправить"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
