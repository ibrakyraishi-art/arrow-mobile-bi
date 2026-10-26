"use client";

import { BRAND_NAME } from "@/lib/brand";
import Link from "next/link";
import { ArrowRight, BookOpen, KeyRound, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Онбординг первого запуска: если не подключён ключ Claude — мягко предлагаем
 * (1) добавить ключ Claude, чтобы попробовать AI-анализ, и (2) открыть Справку,
 * чтобы разобраться, как всё устроено. Баннер исчезает сам, как только ключ
 * добавлен. Показывается на стартовой странице (Источники данных).
 */
export function GetStartedBanner() {
  const settings = useSettingsStore((s) => s.settings);
  const loaded = useSettingsStore((s) => s.loaded);
  const hasClaude = !!settings.providerKeys?.anthropic;
  if (!loaded || hasClaude) return null;

  return (
    <div className="mb-5 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-iris-bright">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">
            Добро пожаловать в {BRAND_NAME} 👋
          </div>
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
            Чтобы попробовать{" "}
            <span className="font-medium text-foreground">AI-анализ</span>, добавьте
            ключ <span className="font-medium text-foreground">Claude</span> в
            настройках (создаётся бесплатно в консоли Anthropic). А чтобы понять,
            как всё устроено за пару минут — загляните в Справку.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="gradient">
              <Link href="/settings">
                <KeyRound className="h-3.5 w-3.5" /> Добавить ключ Claude
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/help">
                <BookOpen className="h-3.5 w-3.5" /> Открыть Справку
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
