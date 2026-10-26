"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const COOLDOWN_S = 60;

/**
 * Кнопка «Отправить письмо подтверждения ещё раз» для НЕподтверждённого email.
 * Используется на регистрации (после signUp) и на входе (если email не
 * подтверждён). Между отправками — таймер ожидания, чтобы не упираться в
 * троттлинг Supabase (письмо можно слать не чаще раза в ~минуту).
 */
export function ResendConfirmation({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function startCooldown(seconds: number) {
    setCooldown(seconds);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  async function resend() {
    const addr = email.trim();
    if (!addr || busy || cooldown > 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const emailRedirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/login`
          : undefined;
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: addr,
        ...(emailRedirectTo ? { options: { emailRedirectTo } } : {}),
      });
      if (error) {
        // Троттлинг: «…after N seconds» — ставим таймер на это время.
        const sec = error.message.match(/after (\d+)\s*seconds?/i)?.[1];
        if (sec) {
          startCooldown(parseInt(sec, 10));
          setMsg("Письмо недавно уже отправлялось — подождите таймер.");
        } else {
          setMsg("Не удалось отправить письмо. Попробуйте позже.");
        }
      } else {
        setMsg(
          "Новое письмо отправлено. Откройте ссылку из самого свежего письма (старые уже не действуют). Проверьте и папку «Спам».",
        );
        startCooldown(COOLDOWN_S);
      }
    } catch {
      setMsg("Не удалось отправить письмо. Попробуйте позже.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={resend}
        disabled={busy || cooldown > 0 || !email.trim()}
      >
        {busy ? (
          <>
            <Loader2 className="animate-spin" />
            Отправляем…
          </>
        ) : cooldown > 0 ? (
          <>Отправить ещё раз через {cooldown} сек</>
        ) : (
          <>
            <MailCheck />
            Отправить письмо ещё раз
          </>
        )}
      </Button>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
