"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users as UsersIcon,
  MessageSquareWarning,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_META,
  fmtMoscow,
  type FeedbackStatus,
} from "@/components/feedback/status";
import { cn } from "@/lib/utils";

interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  role: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  /** Защищён от удаления (сам админ / админ-почта). */
  protected?: boolean;
}
interface Stats {
  total: number;
  new7: number;
  new30: number;
  active30: number;
}
interface AdminFeedback {
  id: string;
  user_id: string;
  email: string | null;
  message: string;
  page_url: string | null;
  status: FeedbackStatus;
  admin_reply: string | null;
  created_at: string;
  updated_at: string;
  screenshot_url: string | null;
}

type SortKey = "date_desc" | "date_asc" | "email";

export function AdminPanel() {
  const [tab, setTab] = useState<"users" | "feedback">("users");
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-brand-500" />
          <h1 className="text-lg font-semibold">Админка</h1>
        </div>
        <div className="mb-5 flex gap-1 border-b border-border">
          <TabBtn active={tab === "users"} onClick={() => setTab("users")} icon={UsersIcon}>
            Пользователи
          </TabBtn>
          <TabBtn
            active={tab === "feedback"}
            onClick={() => setTab("feedback")}
            icon={MessageSquareWarning}
          >
            Обратная связь
          </TabBtn>
        </div>
        {tab === "users" ? <UsersTab /> : <FeedbackTab />}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof UsersIcon;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-brand-500 text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 px-3 py-2">
      <div className="text-lg font-semibold text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function UsersTab() {
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("date_desc");
  // Пользователь, ожидающий подтверждения удаления (открывает модалку).
  const [confirmUser, setConfirmUser] = useState<AdminUser | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      const j = (await res.json()) as {
        users?: AdminUser[];
        stats?: Stats;
        error?: string;
      };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setUsers(j.users ?? []);
      setStats(j.stats ?? null);
    } catch (e) {
      toast({
        title: "Не удалось загрузить пользователей",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      setUsers([]);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const view = useMemo(() => {
    let list = users ?? [];
    const query = q.trim().toLowerCase();
    if (query) list = list.filter((u) => u.email.toLowerCase().includes(query));
    list = [...list].sort((a, b) => {
      if (sort === "email") return a.email.localeCompare(b.email);
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      return sort === "date_asc" ? da - db : db - da;
    });
    return list;
  }, [users, q, sort]);

  async function remove(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      toast({ title: "Пользователь удалён", variant: "success" });
      setConfirmUser(null);
      setUsers((prev) => (prev ? prev.filter((u) => u.id !== id) : prev));
    } catch (e) {
      toast({
        title: "Не удалось удалить",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  if (users === null) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
      </div>
    );
  }

  return (
    <div>
      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard label="Всего" value={stats.total} />
          <StatCard label="За 7 дней" value={stats.new7} />
          <StatCard label="За 30 дней" value={stats.new30} />
          <StatCard label="Активны (30д)" value={stats.active30} />
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по email…"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-9 rounded-md border border-border bg-background px-2 text-xs"
        >
          <option value="date_desc">Сначала новые</option>
          <option value="date_asc">Сначала старые</option>
          <option value="email">По email</option>
        </select>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-card/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Регистрация</th>
              <th className="px-3 py-2 font-medium">Последний вход</th>
              <th className="px-3 py-2 font-medium">Роль</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {view.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <div className="font-mono text-xs">{u.email}</div>
                  {u.full_name && (
                    <div className="text-[11px] text-muted-foreground">
                      {u.full_name}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {fmtMoscow(u.created_at)}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {u.last_sign_in_at ? fmtMoscow(u.last_sign_in_at) : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {u.role ?? "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {u.protected ? (
                    <span
                      title="Администратора удалить нельзя"
                      className="inline-flex h-7 w-7 items-center justify-center text-faint"
                    >
                      <Lock className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmUser(u)}
                      title="Удалить пользователя"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-destructive/15 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {view.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Ничего не найдено.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog
        open={!!confirmUser}
        onOpenChange={(o) => {
          if (!o && busyId === null) setConfirmUser(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Удалить пользователя?
            </DialogTitle>
            <DialogDescription>
              Аккаунт{" "}
              <span className="font-medium text-foreground">
                {confirmUser?.email}
              </span>{" "}
              и ВСЕ его данные (источники, датасеты, визуализации, дашборды,
              алерты, AI-проекты) будут удалены{" "}
              <span className="font-medium text-foreground">безвозвратно</span>.
              Восстановить будет нельзя.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmUser(null)}
              disabled={busyId !== null}
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmUser && void remove(confirmUser.id)}
              disabled={busyId !== null}
            >
              {busyId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Удалить безвозвратно
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FeedbackTab() {
  const { toast } = useToast();
  const [items, setItems] = useState<AdminFeedback[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/feedback");
      const j = (await res.json()) as { items?: AdminFeedback[]; error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setItems(j.items ?? []);
      setDrafts(
        Object.fromEntries((j.items ?? []).map((f) => [f.id, f.admin_reply ?? ""])),
      );
    } catch (e) {
      toast({
        title: "Не удалось загрузить заявки",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      setItems([]);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(
    id: string,
    body: { status?: FeedbackStatus; admin_reply?: string },
  ) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      toast({ title: "Сохранено", variant: "success" });
      setItems((prev) =>
        prev
          ? prev.map((f) => (f.id === id ? { ...f, ...body } : f))
          : prev,
      );
    } catch (e) {
      toast({
        title: "Не удалось сохранить",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  if (items === null) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" /> Обновить
        </Button>
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          Обращений пока нет.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((f) => {
            const meta = FEEDBACK_STATUS_META[f.status];
            return (
              <div key={f.id} className="rounded-xl border border-border bg-card/40 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}
                    >
                      {meta.label}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {f.email ?? f.user_id}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {fmtMoscow(f.created_at)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {f.message}
                </p>
                {f.page_url && (
                  <a
                    href={f.page_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate text-[11px] text-brand-500 hover:underline"
                    title={f.page_url}
                  >
                    {f.page_url}
                  </a>
                )}
                {f.screenshot_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.screenshot_url}
                    alt="Скриншот"
                    className="mt-3 max-h-56 rounded-lg border border-border object-contain bg-background"
                  />
                )}

                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  <textarea
                    value={drafts[f.id] ?? ""}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [f.id]: e.target.value }))
                    }
                    maxLength={5000}
                    placeholder="Ответ пользователю…"
                    className="h-20 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand-500/50"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={f.status}
                      onChange={(e) =>
                        void patch(f.id, {
                          status: e.target.value as FeedbackStatus,
                        })
                      }
                      disabled={busyId === f.id}
                      className="h-9 rounded-md border border-border bg-background px-2 text-xs"
                    >
                      {FEEDBACK_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {FEEDBACK_STATUS_META[s].label}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === f.id}
                      onClick={() =>
                        void patch(f.id, { admin_reply: drafts[f.id] ?? "" })
                      }
                    >
                      {busyId === f.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Сохранить ответ"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="gradient"
                      disabled={busyId === f.id}
                      onClick={() =>
                        void patch(f.id, {
                          status: "resolved",
                          admin_reply: drafts[f.id] ?? "",
                        })
                      }
                    >
                      Ответить и закрыть
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
