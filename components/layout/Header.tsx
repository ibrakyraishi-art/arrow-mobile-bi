"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight,
  LogOut,
  MessageSquareWarning,
  Moon,
  Settings as SettingsIcon,
  Sun,
  User,
  UserCircle2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useDataSourceStore } from "@/stores/dataSourceStore";
import { useDatasetStore } from "@/stores/datasetStore";
import { useVisualizationStore } from "@/stores/visualizationStore";
import { useDashboardStore } from "@/stores/dashboardStore";
import { usePlanStore } from "@/stores/planStore";
import { useAuth, ROLE_LABELS } from "@/lib/auth-context";
import { logAudit } from "@/lib/audit";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReportProblemButton } from "@/components/feedback/ReportProblemButton";
import { cn } from "@/lib/utils";
import { BRAND_NAME } from "@/lib/brand";

const PAGE_LABELS: Record<string, string> = {
  "data-sources": "Источники данных",
  datasets: "Датасеты",
  visualization: "Графики",
  plan: "План",
  notifications: "Уведомления",
  "ai-analysis": "AI-анализ",
  dashboards: "Дашборды",
  history: "История",
  settings: "Настройки",
  new: "Новый",
};

// Each list page is followed by an entity id in the URL; resolve it via the
// corresponding store so the breadcrumb shows a human name instead of a uuid.
const ID_PARENT_SEGMENT = {
  "data-sources": "dataSources",
  datasets: "datasets",
  visualization: "visualizations",
  dashboards: "dashboards",
  plan: "plans",
} as const;

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const segments = pathname.split("/").filter(Boolean);
  const theme = useSettingsStore((s) => s.settings.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const sources = useDataSourceStore((s) => s.sources);
  const datasets = useDatasetStore((s) => s.datasets);
  const visualizations = useVisualizationStore((s) => s.visualizations);
  const dashboards = useDashboardStore((s) => s.dashboards);
  const planProjects = usePlanStore((s) => s.projects);
  const { user, profile, signOut } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  function resolveLabel(seg: string, parent: string | undefined): string {
    if (PAGE_LABELS[seg]) return PAGE_LABELS[seg];
    // Before hydration both server and client render the raw segment — that
    // keeps markup identical and avoids a hydration mismatch for users whose
    // localStorage overrides the initial store state.
    if (!mounted || !parent) return decodeURIComponent(seg);
    const kind = ID_PARENT_SEGMENT[parent as keyof typeof ID_PARENT_SEGMENT];
    if (!kind) return decodeURIComponent(seg);
    if (kind === "dataSources") {
      return sources.find((s) => s.id === seg)?.name ?? decodeURIComponent(seg);
    }
    if (kind === "datasets") {
      return (
        datasets.find((d) => d.id === seg)?.name ?? decodeURIComponent(seg)
      );
    }
    if (kind === "dashboards") {
      return dashboards.find((d) => d.id === seg)?.name ?? decodeURIComponent(seg);
    }
    if (kind === "plans") {
      return planProjects.find((p) => p.id === seg)?.name ?? decodeURIComponent(seg);
    }
    return (
      visualizations.find((v) => v.id === seg)?.name ?? decodeURIComponent(seg)
    );
  }

  const displayName =
    profile?.full_name?.trim() ||
    user?.user_metadata?.full_name ||
    user?.email ||
    "Пользователь";
  const displayRole = profile?.role ? ROLE_LABELS[profile.role] : null;
  const displayEmail = user?.email ?? profile?.email ?? "";

  async function handleSignOut() {
    if (user) {
      await logAudit(getSupabaseBrowserClient(), user.id, "logout");
    }
    await signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/85 px-6 backdrop-blur-md">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link
          href="/"
          className="font-medium text-muted-foreground/80 hover:text-foreground transition-colors"
        >
          <span className="font-semibold text-foreground">{BRAND_NAME}</span>
        </Link>
        {segments.map((seg, i) => {
          const href = "/" + segments.slice(0, i + 1).join("/");
          const parent = i > 0 ? segments[i - 1] : undefined;
          const label = resolveLabel(seg, parent);
          const isLast = i === segments.length - 1;
          return (
            <span key={href} className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
              <Link
                href={href}
                className={cn(
                  "font-medium transition-colors hover:text-foreground max-w-[240px] truncate",
                  isLast && "text-foreground",
                )}
                title={label}
              >
                {label}
              </Link>
            </span>
          );
        })}
      </nav>

      <div className="flex items-center gap-3">
        <ReportProblemButton />
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card/50 text-muted-foreground transition-all hover:border-foreground/20 hover:text-foreground"
          aria-label="Переключить тему"
        >
          {mounted && theme === "dark" ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="hidden items-center gap-3 rounded-lg border border-border bg-card/50 px-3 py-1.5 transition-all hover:border-foreground/20 md:flex"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full tile-gradient">
                <User className="h-3.5 w-3.5" />
              </div>
              <div className="flex flex-col items-start leading-tight">
                <span className="text-xs font-medium max-w-[160px] truncate">
                  {mounted ? displayName : "—"}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {mounted
                    ? displayRole ?? displayEmail ?? "аккаунт"
                    : "…"}
                </span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="flex flex-col gap-0.5 normal-case tracking-normal">
              <span className="text-sm font-semibold text-foreground truncate">
                {displayName}
              </span>
              {displayEmail && (
                <span className="font-mono text-[10px] text-muted-foreground truncate">
                  {displayEmail}
                </span>
              )}
              {displayRole && (
                <span className="mt-1 inline-flex w-fit items-center rounded-md border border-brand-500/30 bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-500">
                  {displayRole}
                </span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" className="w-full cursor-pointer">
                <UserCircle2 className="h-4 w-4" />
                Профиль
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" className="w-full cursor-pointer">
                <SettingsIcon className="h-4 w-4" />
                Настройки
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/feedback" className="w-full cursor-pointer">
                <MessageSquareWarning className="h-4 w-4" />
                Мои обращения
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-destructive focus:text-destructive"
              onSelect={(e) => {
                e.preventDefault();
                void handleSignOut();
              }}
            >
              <LogOut className="h-4 w-4" />
              Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
