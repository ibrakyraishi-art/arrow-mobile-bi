"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Loader2,
  Mail,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase";

/** Понятные сообщения вместо сырых ответов Supabase Auth. */
function mapResetError(message: string): string {
  const m = message.toLowerCase();
  if (
    m.includes("rate limit") ||
    m.includes("rate_limit") ||
    m.includes("too many") ||
    m.includes("over_email_send")
  ) {
    return "Слишком много запросов за короткое время. Подождите ~1 минуту и попробуйте снова.";
  }
  if (m.includes("invalid") && m.includes("email")) {
    return "Некорректный email.";
  }
  return message;
}

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isSupabaseConfigured()) {
      setError("Supabase не настроен. Задайте переменные окружения.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      // Ссылка из письма ведёт на страницу установки НОВОГО пароля.
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/update-password`
          : undefined;
      const { error: err } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        redirectTo ? { redirectTo } : undefined,
      );
      if (err) {
        setError(mapResetError(err.message));
        setLoading(false);
        return;
      }
      setSent(true);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неизвестная ошибка");
      setLoading(false);
    }
  }

  return (
    <Card className="border border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xl">Сброс пароля</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Введите email — мы отправим ссылку для восстановления пароля.
        </p>
      </CardHeader>
      <CardContent>
        {sent ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Письмо отправлено на <b>{email.trim()}</b>. Откройте его и перейдите
                по ссылке — откроется страница, где вы зададите новый пароль. Если
                письма нет — проверьте «Спам» (ссылка действует ограниченное время).
              </span>
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">Вернуться ко входу</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                disabled={loading}
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
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" />
                  Отправка…
                </>
              ) : (
                <>
                  <Mail />
                  Отправить ссылку для сброса
                </>
              )}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Вспомнили пароль?{" "}
              <Link
                href="/login"
                className="font-medium text-foreground transition-colors hover:text-brand-400"
              >
                Войти
              </Link>
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
