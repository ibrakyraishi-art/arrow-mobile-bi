"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
  type Profile,
  type UserRole,
} from "@/lib/supabase";

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  isAuthenticated: boolean;
  /** Признак админа (проверяется на сервере по ADMIN_EMAIL). Только для UI. */
  isAdmin: boolean;
  configured: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Применить профиль и признак админа, уже загруженные сервером
   * (/api/bootstrap через StoreSync) — чтобы браузер не делал отдельные
   * трансграничные запросы /profiles и /api/admin/check.
   */
  applyAuthExtras: (profile: Profile | null, isAdmin: boolean) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Hard safety cap on the initial session probe. If Supabase hangs (offline,
// RLS recursion, CORS, etc.) we still want the UI to render instead of
// spinning forever on "Проверка сессии…".
const SESSION_PROBE_TIMEOUT_MS = 8000;
// Если в браузере уже лежит сессия (cookie sb-…-auth-token), getSession()
// обычно просто обновляет протухший токен — на холодном Supabase это бывает
// дольше 8 с. Отпускать спиннер в этот момент нельзя: user=null уведёт
// вошедшего человека на /login, а через секунду обратно («мигает» вход).
const STORED_SESSION_PROBE_TIMEOUT_MS = 30000;

function hasStoredSession(): boolean {
  try {
    return /(?:^|;\s*)sb-[^=]*-auth-token(?:\.\d+)?=/.test(document.cookie);
  } catch {
    return false;
  }
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.warn("[auth] fetchProfile error", error.message);
      return null;
    }
    return (data as Profile | null) ?? null;
  } catch (e) {
    console.warn("[auth] fetchProfile exception", e);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  // Start loading only when Supabase is configured — otherwise we stay in a
  // permanent "unauthenticated" state so ProtectedRoute can redirect to /login.
  const [loading, setLoading] = useState<boolean>(configured);
  const mountedRef = useRef(true);

  const refreshProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      return;
    }
    const p = await fetchProfile(user.id);
    if (mountedRef.current) setProfile(p);
  }, [user]);

  // Профиль + признак админа приходят с сервера (bootstrap) — кладём их в стейт.
  const applyAuthExtras = useCallback(
    (p: Profile | null, admin: boolean) => {
      if (!mountedRef.current) return;
      setProfile(p);
      setIsAdmin(admin);
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (!configured) {
      setLoading(false);
      return () => {
        mountedRef.current = false;
      };
    }

    const supabase = getSupabaseBrowserClient();
    let finished = false;

    const finishLoading = () => {
      if (finished) return;
      finished = true;
      if (mountedRef.current) setLoading(false);
    };

    // Принудительный выход: чистим локальное состояние и завершаем сессию.
    const forceSignOut = () => {
      if (mountedRef.current) {
        setSession(null);
        setUser(null);
        setProfile(null);
        setIsAdmin(false);
      }
      void supabase.auth.signOut().catch(() => {});
    };

    // Кэшированная сессия (getSession) читается локально и НЕ сверяется с
    // сервером — она может принадлежать уже УДАЛЁННОМУ аккаунту. Поэтому
    // дополнительно валидируем пользователя на сервере (getUser ходит в
    // Supabase) и, если его больше нет либо токен отозван, выходим — тогда
    // ProtectedRoute уведёт на /login. На сетевых ошибках НЕ разлогиниваем,
    // чтобы не выкинуть живого пользователя при временном сбое.
    const validateUserStillExists = async () => {
      try {
        const { data: u, error } = await supabase.auth.getUser();
        if (!mountedRef.current) return;
        const status = (error as { status?: number } | null)?.status;
        const definitivelyGone =
          (Boolean(error) && (status === 401 || status === 403)) ||
          (!error && !u?.user);
        if (definitivelyGone) forceSignOut();
      } catch {
        /* сеть недоступна — оставляем кэш-сессию как есть */
      }
    };

    // Safety net: if getSession() never resolves we still release the UI.
    const safetyTimer = setTimeout(
      () => {
        if (!finished) {
          console.warn(
            "[auth] getSession() exceeded timeout — releasing loading state",
          );
          finishLoading();
        }
      },
      hasStoredSession()
        ? STORED_SESSION_PROBE_TIMEOUT_MS
        : SESSION_PROBE_TIMEOUT_MS,
    );

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mountedRef.current) return;
        setSession(data.session);
        setUser(data.session?.user ?? null);
        // Release the spinner as soon as session state is known. The profile
        // fetch runs in the background — it must never block the UI because
        // (a) it can fail under RLS, (b) it's not required for routing.
        finishLoading();
        if (data.session?.user) {
          // Профиль и isAdmin теперь приходят с сервера через bootstrap
          // (StoreSync → applyAuthExtras), без отдельных запросов из браузера.
          // Здесь только проверяем, что аккаунт ещё существует (удалённый
          // пользователь со старой кэш-сессией).
          void validateUserStillExists();
        }
      })
      .catch((e) => {
        console.warn("[auth] getSession failed", e);
        finishLoading();
      });

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!mountedRef.current) return;
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        // Any auth-state change (incl. SIGNED_IN / SIGNED_OUT / INITIAL_SESSION)
        // means the session is now known → we can safely release the spinner.
        finishLoading();
        if (!nextSession?.user) {
          // Вышли из аккаунта — чистим профиль и признак админа.
          setProfile(null);
          setIsAdmin(false);
        }
        // При входе профиль и isAdmin загрузит StoreSync через bootstrap
        // (applyAuthExtras) — отдельных запросов из браузера здесь больше нет.
      },
    );

    return () => {
      mountedRef.current = false;
      clearTimeout(safetyTimer);
      sub.subscription.unsubscribe();
    };
  }, [configured]);

  const signOut = useCallback(async () => {
    if (!configured) return;
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
    setIsAdmin(false);
  }, [configured]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      session,
      loading,
      isAuthenticated: Boolean(user),
      isAdmin,
      configured,
      refreshProfile,
      signOut,
      applyAuthExtras,
    }),
    [user, profile, session, loading, isAdmin, configured, refreshProfile, signOut, applyAuthExtras],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Администратор",
  analyst: "Аналитик",
  buyer: "Байер",
  manager: "Менеджер",
};
