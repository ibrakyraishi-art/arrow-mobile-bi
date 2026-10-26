"use client";

import { BRAND_NAME } from "@/lib/brand";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Loader2,
  UserPlus,
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
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Сообщение «письмо отправлено». Переиспользуем в обычном пути И при сетевом
 *  обрыве (когда signUp прошёл на сервере, письмо ушло, но ответ не дошёл). */
const SENT_INFO =
  "Письмо для подтверждения отправлено на ваш email. Перейдите по ссылке в письме для активации аккаунта (действует 24 часа). Если письма нет во «Входящих» — проверьте папку «Спам»: домен новый, и письмо иногда попадает туда.";

/**
 * Троттлинг отправки письма (Supabase): «For security purposes, you can only
 * request this after N seconds», «rate limit», «too many» и т.п. Это НЕ
 * фатально — письмо с предыдущей попытки обычно уже отправлено.
 */
function isThrottleError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("for security purposes") ||
    m.includes("you can only request this") ||
    m.includes("rate limit") ||
    m.includes("too many") ||
    m.includes("over_email_send")
  );
}

/** Понятные сообщения вместо сырых ответов Supabase Auth. */
function mapRegisterError(message: string): string {
  const m = message.toLowerCase();
  if (
    m.includes("already registered") ||
    m.includes("already exists") ||
    m.includes("user already")
  ) {
    return "Этот email уже зарегистрирован. Войдите в аккаунт или восстановите пароль, если забыли его.";
  }
  if (isThrottleError(message)) {
    const sec = message.match(/after (\d+)\s*seconds?/i)?.[1];
    return sec
      ? `Письмо уже отправлялось недавно — повторить можно через ${sec} сек. Проверьте почту, включая папку «Спам».`
      : "Письмо уже отправлялось недавно. Немного подождите и проверьте почту (включая «Спам»).";
  }
  return message;
}

export default function RegisterPage() {
  const router = useRouter();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Redirect reactively once AuthProvider confirms the session — avoids the
  // race between `signUp` and onAuthStateChange that can cause an infinite
  // /register → /data-sources → /login loop.
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.replace("/data-sources");
    }
  }, [authLoading, isAuthenticated, router]);

  function validate(): string | null {
    if (!fullName.trim()) return "Укажите имя.";
    if (!EMAIL_RE.test(email.trim())) return "Некорректный email.";
    if (password.length < 6) return "Пароль должен быть не короче 6 символов.";
    if (password !== passwordConfirm) return "Пароли не совпадают.";
    return null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      // Регистрация идёт через НАШ сервер (Vercel↔Supabase — надёжно и быстро),
      // а не напрямую из браузера в supabase.co. Так уходит «Failed to fetch»
      // на медленном трансграничном запросе из РФ.
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim(),
          password,
          redirectTo:
            typeof window !== "undefined"
              ? `${window.location.origin}/login`
              : undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        code?: string;
        error?: string;
        retryAfter?: number;
      };

      if (res.ok && json.ok) {
        setInfo(SENT_INFO);
        setLoading(false);
        return;
      }
      if (json.code === "already_registered") {
        setError(
          "Этот email уже зарегистрирован. Войдите в аккаунт или восстановите пароль, если забыли его.",
        );
      } else if (json.code === "throttled") {
        // Не фатально: письмо, скорее всего, уже отправлено — спокойный инфо-блок.
        setInfo(
          json.retryAfter
            ? `Письмо уже отправлялось недавно — повторить можно через ${json.retryAfter} сек. Проверьте почту, включая папку «Спам».`
            : "Письмо уже отправлялось недавно. Немного подождите и проверьте почту (включая «Спам»).",
        );
      } else {
        setError(
          json.error
            ? mapRegisterError(json.error)
            : `Не удалось зарегистрироваться (HTTP ${res.status}). Попробуйте ещё раз.`,
        );
      }
      setLoading(false);
    } catch {
      // Сюда попадаем, только если не достучались до НАШЕГО сервера (редко).
      setError(
        "Не удалось связаться с сервером. Проверьте интернет и попробуйте ещё раз.",
      );
      setLoading(false);
    }
  }

  return (
    <Card className="border border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xl">Создать аккаунт</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Зарегистрируйтесь, чтобы получить доступ к {BRAND_NAME}.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Имя</Label>
            <Input
              id="fullName"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Иван Иванов"
              disabled={loading}
            />
          </div>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <PasswordInput
                id="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Минимум 6 символов"
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="passwordConfirm">Подтвердите</Label>
              <PasswordInput
                id="passwordConfirm"
                autoComplete="new-password"
                required
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="Повторите пароль"
                disabled={loading}
              />
            </div>
          </div>
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {info && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{info}</span>
              </div>
              {/* Письмо не пришло? Можно отправить ещё раз (пока не подтверждён). */}
              <ResendConfirmation email={email} />
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
                Отправляем письмо…
              </>
            ) : (
              <>
                <UserPlus />
                Зарегистрироваться
              </>
            )}
          </Button>

          {loading && (
            <p className="text-center text-xs text-muted-foreground">
              Создаём аккаунт и отправляем письмо для подтверждения — это может
              занять несколько секунд.
            </p>
          )}

          <p className="text-center text-sm text-muted-foreground">
            Уже есть аккаунт?{" "}
            <Link
              href="/login"
              className="font-medium text-foreground transition-colors hover:text-brand-400"
            >
              Войти
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
