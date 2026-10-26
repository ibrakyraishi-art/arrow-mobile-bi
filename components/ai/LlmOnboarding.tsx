"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Компактный онбординг-блок для AI-анализа, когда не подключена НИ ОДНА LLM.
 * Не вываливает весь список провайдеров — мягкая подсказка + переход в Настройки,
 * где находится управление ключами (BYOK). Исчезает, как только подключён хотя
 * бы один провайдер (условие проверяется на странице).
 */
export function LlmOnboarding() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-iris-bright">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">
            Подключите LLM, чтобы начать анализ
          </div>
          <p className="text-[12px] leading-snug text-muted-foreground">
            Нужен ключ хотя бы одного провайдера (Claude, GPT, Gemini, Groq,
            Cerebras, Mistral). У многих есть бесплатный лимит. Ключи хранятся
            зашифрованными на сервере.
          </p>
        </div>
      </div>
      <Button asChild size="sm" className="shrink-0">
        <Link href="/settings">
          Подключить в настройках <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </Button>
    </div>
  );
}
