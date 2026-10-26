"use client";

import { BRAND_NAME } from "@/lib/brand";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, KeyRound, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase";

type Phase = "checking" | "ready" | "invalid" | "saving" | "done";

/**
 * Установка нового пароля по ссылке из письма. Пользователь приходит сюда с
 * сессией восстановления (её ставит /auth/confirm или браузерный клиент из
 * URL). Здесь задаёт новый пароль → выходим → просим войти с новым паролем.
 */
export default function UpdatePasswordPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(
    isSupabaseConfigured() ? "checking" : "invalid",
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = getSupabaseBrowserClient();
    let done = false;
    const ready = () => {
      if (!done) {
        done = true;
        setPhase("ready");
      }
    };

    // Сессия могла уже установиться (cookie от /auth/confirm или из URL —
    // браузерный клиент сам обменивает код/хэш). Проверяем + слушаем событие.
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) ready();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) ready();
    });

    // Нет сессии за разумное время → ссылка недействительна/истекла.
    const t = setTimeout(() => {
      if (!done) setPhase((p) => (p === "checking" ? "invalid" : p));
    }, 6000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(t);
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError("Пароль должен быть не короче 6 символов.");
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают.");
      return;
    }
    setError(null);
    setPhase("saving");
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) {
        setError(err.message);
        setPhase("ready");
        return;
      }
      // Выходим из восстановительной сессии и просим войти с новым паролем.
      await supabase.auth.signOut();
      setPhase("done");
      setTimeout(() => router.replace("/login?reset=1"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неизвестная ошибка");
      setPhase("ready");
    }
  }

  return (
    <Card className="border border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xl">Новый пароль</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Задайте новый пароль для входа в {BRAND_NAME}.
        </p>
      </CardHeader>
      <CardContent>
        {phase === "checking" && (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Проверяем ссылку…
          </div>
        )}

        {phase === "invalid" && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Ссылка для сброса недействительна или истекла. Запросите новую.
              </span>
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link href="/reset-password">Запросить ссылку заново</Link>
            </Button>
          </div>
        )}

        {phase === "done" && (
          <div className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Пароль обновлён. Перенаправляем на вход…</span>
          </div>
        )}

        {(phase === "ready" || phase === "saving") && (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Новый пароль</Label>
              <PasswordInput
                id="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Минимум 6 символов"
                disabled={phase === "saving"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Подтвердите</Label>
              <PasswordInput
                id="confirm"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Повторите пароль"
                disabled={phase === "saving"}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              variant="gradient"
              className="w-full"
              disabled={phase === "saving"}
            >
              {phase === "saving" ? (
                <>
                  <Loader2 className="animate-spin" />
                  Сохранение…
                </>
              ) : (
                <>
                  <KeyRound />
                  Сохранить новый пароль
                </>
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
