"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth, ROLE_LABELS } from "@/lib/auth-context";
import type { UserRole } from "@/lib/supabase";

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: UserRole[];
}

export function ProtectedRoute({
  children,
  allowedRoles,
}: ProtectedRouteProps) {
  const { loading, isAuthenticated, profile, configured } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!configured) return;
    if (!loading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [configured, loading, isAuthenticated, router]);

  if (!configured) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <div className="max-w-md rounded-xl border border-warning/30 bg-card/60 p-6 text-center shadow-sm backdrop-blur-xl">
          <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-warning" />
          <h2 className="text-base font-semibold">Supabase не настроен</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Задайте <code>NEXT_PUBLIC_SUPABASE_URL</code> и{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> в переменных окружения.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Проверка сессии…</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Перенаправление…</span>
        </div>
      </div>
    );
  }

  if (allowedRoles && allowedRoles.length > 0) {
    const role = profile?.role;
    if (!role || !allowedRoles.includes(role)) {
      const allowed = allowedRoles.map((r) => ROLE_LABELS[r]).join(", ");
      return (
        <div className="flex h-full w-full items-center justify-center p-8">
          <div className="max-w-md rounded-xl border border-destructive/30 bg-card/60 p-6 text-center shadow-sm backdrop-blur-xl">
            <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-destructive" />
            <h2 className="text-base font-semibold">Доступ запрещён</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Эта страница доступна только для ролей: {allowed}.
            </p>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}
