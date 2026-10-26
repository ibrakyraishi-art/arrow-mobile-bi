"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogIn, AlertCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/use-toast";
import { logAudit } from "@/lib/audit";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";

function mapError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "Неверный email или пароль.";
  }
  if (m.includes("email not confirmed")) {
    return "Email не подтверждён. Проверьте почту.";
  }
  if (m.includes("user not found")) {
    return "Пользователь с таким email не найден.";
  }
  return message;
}

// Reads ?error=confirmation_failed and raises a toast. Extracted so the page
// can wrap it in <Suspense> — `useSearchParams` otherwise forces CSR bailout
// on the whole route and fails `next build`.
function ConfirmationErrorToast() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  useEffect(() => {
    if (searchParams.get("error") === "confirmation_failed") {
      toast({
        variant: "destructive",
        title: "Подтверждение не удалось",
        description:
          "Ссылка подтверждения истекла или недействительна. Попробуйте зарегистрироваться снова.",
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      window.history.replaceState({}, "", url.toString());
    }
    if (searchParams.get("reset") === "1") {
      toast({
        variant: "success",
        title: "Пароль обновлён",
        description: "Войдите с новым паролем.",
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("reset");
      window.history.replaceState({}, "", url.toString());
    }
    // Пришли по ссылке из письма, но сессию по ней получить не удалось
    // (ссылку мог «открыть» сканер почты, или она устарела). Аккаунт при
    // этом обычно уже активирован — просто входим email и паролем.
    if (searchParams.get("notice") === "confirm") {
      toast({
        title: "Аккаунт активирован — войдите",
        description:
          "Похоже, вы перешли по ссылке из письма. Войдите вашим email и паролем, которые указывали при регистрации.",
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("notice");
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams, toast]);
  return null;
}

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Email зарегистрирован, но не подтверждён → предложим отправить письмо заново.
  const [unconfirmed, setUnconfirmed] = useState(false);

  // Redirect reactively once AuthProvider state reflects the new session.
  // Navigating inside the onSubmit handler races with onAuthStateChange and
  // can cause ProtectedRoute to bounce back to /login before the provider
  // has seen the SIGNED_IN event → infinite loop.
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.replace("/data-sources");
    }
  }, [authLoading, isAuthenticated, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isSupabaseConfigured()) {
      setError("Supabase не настроен. Задайте переменные окружения.");
      return;
    }
    setError(null);
    setUnconfirmed(false);
    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (err) {
        setError(mapError(err.message));
        // Email не подтверждён → показать кнопку повторной отправки письма.
        if (/not confirmed/i.test(err.message)) setUnconfirmed(true);
        setLoading(false);
        return;
      }
      if (data.user) {
        void logAudit(supabase, data.user.id, "login");
      }
      // Do NOT navigate here — the useEffect above will redirect as soon as
      // AuthProvider picks up the SIGNED_IN event. We keep `loading=true`
      // so the submit button stays disabled during that brief window.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неизвестная ошибка");
      setLoading(false);
    }
  }

  return (
    <Card className="border border-border bg-card">
      <Suspense fallback={null}>
        <ConfirmationErrorToast />
      </Suspense>
      <CardHeader>
        <CardTitle className="text-xl">Вход в аккаунт</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Введите email и пароль для доступа к BI-платформе.
        </p>
      </CardHeader>
      <CardContent>
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
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Пароль</Label>
              <Link
                href="/reset-password"
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Забыли пароль?
              </Link>
            </div>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {unconfirmed && <ResendConfirmation email={email} />}

          <Button
            type="submit"
            variant="gradient"
            className="w-full"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin" />
                Вход…
              </>
            ) : (
              <>
                <LogIn />
                Войти
              </>
            )}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Нет аккаунта?{" "}
            <Link
              href="/register"
              className="font-medium text-foreground transition-colors hover:text-brand-400"
            >
              Зарегистрироваться
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
