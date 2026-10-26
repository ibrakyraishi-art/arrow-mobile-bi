"use client";

import { BRAND_NAME } from "@/lib/brand";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Bot,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Loader2,
  Plus,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { EmptyState } from "@/components/layout/PageContainer";
import type { TelegramConnection } from "@/lib/types";

interface Props {
  refreshKey?: number;
}

export function ConnectionsTab({ refreshKey }: Props) {
  const { toast } = useToast();
  const [items, setItems] = useState<TelegramConnection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/telegram", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setItems(json.connections as TelegramConnection[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function onTest(c: TelegramConnection) {
    const id = toast({ title: "Отправляем тестовое сообщение…" });
    try {
      const res = await fetch(`/api/telegram/${c.id}/test`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast({
        title: "Сообщение отправлено",
        description: `Бот @${c.botUsername} → ${c.chatTitle}`,
        variant: "success",
      });
      await load();
    } catch (e) {
      toast({
        title: "Не удалось отправить тест",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      await load();
    }
    void id;
  }

  async function onDelete(c: TelegramConnection) {
    if (!confirm(`Удалить подключение «${c.name}»?`)) return;
    try {
      const res = await fetch(`/api/telegram/${c.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast({ title: "Подключение удалено", variant: "success" });
      await load();
    } catch (e) {
      toast({
        title: "Не удалось удалить",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          Подключайте Telegram-ботов и привязывайте их к чатам/каналам, в
          которые алерты будут отправляться. Токен хранится зашифрованным
          (AES-256) и никогда не покидает сервер.
        </div>
        <Button variant="gradient" onClick={() => setOpen(true)}>
          <Plus />
          Добавить бота
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6 text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      {items === null ? (
        <Card>
          <CardContent className="flex items-center gap-3 pt-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка…
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Bot className="h-6 w-6" />}
          title="Нет подключений"
          description="Создайте Telegram-бота через @BotFather и подключите его, чтобы получать алерты в нужный чат."
          action={
            <Button variant="outline" onClick={() => setOpen(true)}>
              <Plus />
              Добавить бота
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((c) => (
            <ConnectionCard
              key={c.id}
              connection={c}
              onTest={() => onTest(c)}
              onDelete={() => onDelete(c)}
            />
          ))}
        </div>
      )}

      <AddConnectionDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={() => {
          setOpen(false);
          void load();
        }}
      />
    </div>
  );
}

function ConnectionCard({
  connection,
  onTest,
  onDelete,
}: {
  connection: TelegramConnection;
  onTest: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{connection.name}</span>
              {connection.isVerified ? (
                <Badge variant="success" className="gap-1">
                  <BadgeCheck className="h-3 w-3" />
                  Верифицировано
                </Badge>
              ) : (
                <Badge variant="warning">Не проверено</Badge>
              )}
            </div>
            <div className="mt-1 font-mono text-xs text-muted-foreground">
              @{connection.botUsername} → {connection.chatTitle}
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
              chat_id: {connection.chatId}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {connection.lastTestStatus === "ok" ? (
            <span className="inline-flex items-center gap-1 text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Последний тест: ok
            </span>
          ) : connection.lastTestStatus === "error" ? (
            <span
              className="inline-flex items-center gap-1 text-destructive"
              title={connection.lastTestError ?? ""}
            >
              <XCircle className="h-3.5 w-3.5" />
              {connection.lastTestError ?? "ошибка"}
            </span>
          ) : (
            <span className="text-muted-foreground">Не проверялось</span>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onTest}>
            <Send />
            Тест
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 />
            Удалить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Лёгкие клиентские подсказки для типичных ошибок ввода Chat ID.
 * Не блокируют отправку — только подсвечивают сомнительные значения.
 */
function getChatIdWarning(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  // Похоже на email (что-то@что-то.что-то)
  if (/^\S+@\S+\.\S+$/.test(v)) {
    return "Похоже, вы ввели email. Chat ID — это число от @userinfobot, не email.";
  }
  // @username канала разрешён
  if (v.startsWith("@")) return null;
  // Отрицательные ID должны начинаться с -100
  if (v.startsWith("-") && !v.startsWith("-100")) {
    return "Для групп Chat ID должен начинаться с -100. Возможно, вы скопировали старый формат.";
  }
  // Слишком короткое число
  if (/^-?\d+$/.test(v)) {
    const digitsOnly = v.replace(/\D/g, "");
    if (digitsOnly.length < 5) {
      return "Chat ID обычно имеет 9-13 цифр. Проверьте, что скопировали число полностью.";
    }
  }
  return null;
}

function getTokenWarning(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length < 35) {
    return "Токен выглядит коротким. Проверьте, что скопировали целиком.";
  }
  return null;
}

function AddConnectionDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [tokenTouched, setTokenTouched] = useState(false);
  const [chatIdTouched, setChatIdTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);

  const tokenWarning = tokenTouched ? getTokenWarning(token) : null;
  const chatIdWarning = chatIdTouched ? getChatIdWarning(chatId) : null;

  useEffect(() => {
    if (!open) {
      setName("");
      setToken("");
      setChatId("");
      setTokenTouched(false);
      setChatIdTouched(false);
      setStep(null);
      setBusy(false);
    }
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStep("verify");
    try {
      const res = await fetch("/api/telegram/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          token: token.trim(),
          chatId: chatId.trim(),
        }),
      });
      const json: Record<string, unknown> = await res.json();
      if (!res.ok) {
        const stepLabel = json.step ? ` (шаг: ${json.step})` : "";
        const headline = `${String(json.error ?? `HTTP ${res.status}`)}${stepLabel}`;
        toast({
          title: "Не удалось подключить бота",
          description: headline,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Подключение создано",
        description: `@${(json.connection as { botUsername: string }).botUsername} → ${(json.connection as { chatTitle: string }).chatTitle}`,
        variant: "success",
      });
      onCreated();
    } catch (e) {
      const fallback = e instanceof Error ? e.message : String(e);
      toast({
        title: "Не удалось подключить бота",
        description: fallback,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Подключение Telegram-бота</DialogTitle>
          <DialogDescription>
            Бот должен быть создан в @BotFather и добавлен в нужный чат как
            администратор (для каналов/групп). Токен хранится в БД зашифрованным.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="conn-name">Название</Label>
            <Input
              id="conn-name"
              placeholder="Например, Yango алерты"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Название только для вашего удобства, чтобы различать ботов в
              списке. В Telegram оно не отображается. Например:{" "}
              <span className="font-medium text-foreground/80">
                «Yango алерты»
              </span>{" "}
              или{" "}
              <span className="font-medium text-foreground/80">
                «{BRAND_NAME}»
              </span>
              .
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="conn-token">Bot Token</Label>
            <Input
              id="conn-token"
              type="password"
              placeholder="1234567890:AAH..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onBlur={() => setTokenTouched(true)}
              required
              autoComplete="off"
              aria-invalid={tokenWarning ? true : undefined}
            />
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p>
                Bot Token — длинный ключ (40+ символов), который вы получили от{" "}
                <span className="font-medium text-foreground/80">@BotFather</span>{" "}
                после создания бота. Формат:{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  1234567890:AAH...
                </code>
              </p>
              <p>
                <span className="text-warning">⚠️</span> Никому не показывайте
                этот токен. Если случайно засветили — отзовите через @BotFather
                командой{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  /revoke
                </code>
                .
              </p>
              <p>
                Нет бота?{" "}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-brand-500 hover:text-brand-400 hover:underline"
                >
                  Создать бота в @BotFather
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>
            {tokenWarning && (
              <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{tokenWarning}</span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="conn-chat">Chat ID</Label>
            <Input
              id="conn-chat"
              placeholder="-1001234567890 или @channel"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              onBlur={() => setChatIdTouched(true)}
              required
              autoComplete="off"
              aria-invalid={chatIdWarning ? true : undefined}
            />
            <p className="text-xs text-muted-foreground">
              Chat ID — это идентификатор места, куда бот будет присылать
              сообщения (твой личный чат, группа или канал).
            </p>

            <details className="group rounded-md border border-border bg-secondary/40">
              <summary className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-xs font-medium text-foreground/90 transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                <span>Как узнать Chat ID?</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-3 border-t border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                <div>
                  <div className="text-xs font-semibold text-foreground">
                    Вариант 1. Личный чат{" "}
                    <span className="font-normal text-brand-500">
                      (рекомендуется)
                    </span>
                  </div>
                  <p className="mt-1">
                    Если хотите получать алерты лично себе:
                  </p>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                    <li>
                      Откройте Telegram и найдите бота{" "}
                      <span className="font-medium text-foreground/80">
                        @userinfobot
                      </span>
                    </li>
                    <li>
                      Нажмите{" "}
                      <span className="font-medium text-foreground/80">
                        Start
                      </span>
                    </li>
                    <li>
                      Скопируйте число из строки{" "}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                        Id: ...
                      </code>{" "}
                      — это и есть ваш Chat ID
                    </li>
                    <li>
                      Не забудьте написать{" "}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                        /start
                      </code>{" "}
                      своему боту, иначе он не сможет вам писать
                    </li>
                  </ol>
                  <p className="mt-1.5 font-mono text-[11px] text-muted-foreground/80">
                    Пример ID:{" "}
                    <span className="text-foreground/80">1782980460</span>{" "}
                    (просто число)
                  </p>
                </div>

                <div>
                  <div className="text-xs font-semibold text-foreground">
                    Вариант 2. Группа
                  </div>
                  <p className="mt-1">
                    Если алерты должны приходить в группу с командой:
                  </p>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                    <li>
                      Создайте группу в Telegram, добавьте туда вашего бота
                    </li>
                    <li>Сделайте бота администратором группы</li>
                    <li>Напишите в группе любое сообщение</li>
                    <li>
                      Перешлите это сообщение боту{" "}
                      <span className="font-medium text-foreground/80">
                        @userinfobot
                      </span>
                    </li>
                    <li>
                      Скопируйте число из ответа (начинается с{" "}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                        -100
                      </code>
                      )
                    </li>
                  </ol>
                  <p className="mt-1.5 font-mono text-[11px] text-muted-foreground/80">
                    Пример ID:{" "}
                    <span className="text-foreground/80">-1001234567890</span>{" "}
                    (с минусом обязательно)
                  </p>
                </div>

                <div>
                  <div className="text-xs font-semibold text-foreground">
                    Вариант 3. Канал
                  </div>
                  <p className="mt-1">Если используете канал:</p>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                    <li>
                      Добавьте бота как администратора канала с правом постить
                      сообщения
                    </li>
                    <li>Опубликуйте любое сообщение</li>
                    <li>
                      Перешлите его боту{" "}
                      <span className="font-medium text-foreground/80">
                        @userinfobot
                      </span>
                    </li>
                    <li>
                      Скопируйте полученный ID или используйте{" "}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                        @username
                      </code>{" "}
                      канала
                    </li>
                  </ol>
                  <p className="mt-1.5 font-mono text-[11px] text-muted-foreground/80">
                    Пример:{" "}
                    <span className="text-foreground/80">-1001234567890</span>{" "}
                    или{" "}
                    <span className="text-foreground/80">@my_channel</span>
                  </p>
                </div>

                <p className="border-t border-border pt-2 text-[11px] text-muted-foreground">
                  ⚠️ Chat ID — это число (не email, не username бота). Для
                  личного чата это совпадает с вашим ID пользователя в Telegram.
                </p>
              </div>
            </details>

            {chatIdWarning && (
              <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{chatIdWarning}</span>
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Отмена
            </Button>
            <Button type="submit" variant="gradient" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="animate-spin" />
                  Проверка{step ? `: ${step}` : ""}…
                </>
              ) : (
                <>Проверить и сохранить</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
