"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import {
  MODEL_ORDER,
  PROVIDER_LIST,
  PROVIDERS,
  isProviderEnabled,
  resolveModel,
  type AIProvider,
} from "@/lib/ai-models";
import { cn } from "@/lib/utils";

function ProviderKeyRow({ provider }: { provider: AIProvider }) {
  const settings = useSettingsStore((s) => s.settings);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const { toast } = useToast();
  const meta = PROVIDERS[provider];
  const enabled = isProviderEnabled(provider);
  const marker = settings.providerKeys[provider];
  const configured = !!marker;
  // "unverified" — ключ сохранён, но проверка реальным вызовом не подтвердилась.
  const unverified = marker === "unverified";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  const open = editing || !configured;

  // Пока доступен только Claude (Anthropic). Остальные провайдеры показываем
  // как «Скоро» — без поля ключа (интеграцию добавим позже).
  if (!enabled) {
    return (
      <div className="rounded-lg border border-border bg-card/40 p-2.5 opacity-70">
        <div className="flex items-center gap-2">
          <span className="text-sm leading-none">{meta.icon}</span>
          <span className="text-sm font-medium">{meta.label}</span>
          <Badge variant="outline" className="ml-auto text-muted-foreground">
            Скоро
          </Badge>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          Интеграция появится позже. Сейчас доступен Claude (Anthropic).
        </p>
      </div>
    );
  }

  async function save() {
    setSaving(true);
    try {
      const { warning } = await setApiKey(provider, draft.trim());
      setDraft("");
      setEditing(false);
      if (warning) {
        toast({
          title: `Ключ ${meta.label}: проверка не прошла`,
          description: warning,
          variant: "destructive",
        });
      } else {
        toast({
          title: `Ключ ${meta.label} сохранён и проверен`,
          variant: "success",
        });
      }
    } catch (e) {
      toast({
        title: "Не удалось сохранить ключ",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card/40 p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm leading-none">{meta.icon}</span>
        <span className="text-sm font-medium">{meta.label}</span>
        {configured ? (
          unverified ? (
            <Badge
              variant="outline"
              className="ml-auto gap-1 border-warning/50 text-warning"
            >
              <AlertTriangle className="h-3 w-3" /> Не проверен
            </Badge>
          ) : (
            <Badge variant="success" className="ml-auto gap-1">
              <Check className="h-3 w-3" /> Настроен
            </Badge>
          )
        ) : (
          <Badge variant="outline" className="ml-auto text-muted-foreground">
            Нет ключа
          </Badge>
        )}
        {configured && !editing && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setEditing(true)}
          >
            Изменить
          </Button>
        )}
      </div>

      {/* Доступные модели провайдера — показываем, когда ключ подключён. */}
      {configured && !editing && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {MODEL_ORDER.filter((id) => resolveModel(id).provider === provider).map(
            (id) => {
              const m = resolveModel(id);
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  <span className="leading-none">{m.icon}</span>
                  {m.label}
                </span>
              );
            },
          )}
        </div>
      )}

      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder={meta.keyPlaceholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-8 font-mono text-xs"
            />
            <Button
              size="sm"
              variant="gradient"
              className="h-8 shrink-0"
              onClick={save}
              disabled={!draft.trim() || saving}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Сохранить"}
            </Button>
            {configured && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 shrink-0 px-2 text-xs"
                onClick={() => {
                  setEditing(false);
                  setDraft("");
                }}
              >
                Отмена
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <a
              href={meta.consoleUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> {meta.consoleLabel}
            </a>
            <button
              type="button"
              onClick={() => setShowSteps((v) => !v)}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              как получить ключ
              <ChevronDown
                className={cn("h-3 w-3 transition-transform", showSteps && "rotate-180")}
              />
            </button>
          </div>
          {showSteps && (
            <ol className="list-decimal space-y-0.5 pl-4 text-[11px] leading-snug text-muted-foreground">
              {meta.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Настройка ключей всех LLM-провайдеров (BYOK). У каждого — статус, поле ключа,
 * ссылка на консоль и мини-инструкция «как получить ключ». Ключи шифруются на
 * сервере и на клиент не возвращаются.
 */
export function ApiKeySetup({ compact = false }: { compact?: boolean }) {
  return (
    <Card className={compact ? undefined : "shiny-border"}>
      <CardHeader className={cn("space-y-1", compact && "p-3 pb-1.5")}>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-brand-500" /> Модели и ключи
        </CardTitle>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Сейчас доступен <span className="font-medium text-foreground">Claude (Anthropic)</span>,
          остальные — скоро. Ключ свой (BYOK): шифруется и хранится на сервере,
          на клиент не возвращается — его использует только сервер при анализе.
        </p>
      </CardHeader>
      <CardContent className={cn("space-y-2", compact && "p-3 pt-0")}>
        {PROVIDER_LIST.map((p) => (
          <ProviderKeyRow key={p} provider={p} />
        ))}
      </CardContent>
    </Card>
  );
}
