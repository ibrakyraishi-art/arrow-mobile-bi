"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowMark, ArrowWordmark } from "@/components/layout/ArrowLogo";
import { BRAND_NAME } from "@/lib/brand";
import {
  Database,
  LayoutGrid,
  LayoutDashboard,
  BarChart3,
  Target,
  Sparkles,
  Settings,
  Bell,
  ShieldCheck,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import type { UserRole } from "@/lib/supabase";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Database;
  hint: string;
  // Roles that should NOT see this item. Empty/missing = visible to everyone.
  hideForRoles?: UserRole[];
  /** Показать бейдж «Бета» рядом с названием. */
  beta?: boolean;
};

// Порядок как в DataLens: источник → датасет → график → дашборд, затем план,
// AI и уведомления; служебные разделы — в конце.
const NAV: NavItem[] = [
  {
    href: "/data-sources",
    label: "Источники",
    icon: Database,
    hint: "ClickHouse, CSV, Excel и Google Таблицы",
  },
  {
    href: "/datasets",
    label: "Датасеты",
    icon: LayoutGrid,
    hint: "Настройка столбцов и вычисляемые поля",
  },
  {
    href: "/visualization",
    label: "Графики",
    icon: BarChart3,
    hint: "Сводные таблицы и графики",
    beta: true,
  },
  {
    href: "/dashboards",
    label: "Дашборды",
    icon: LayoutDashboard,
    hint: "Листы, виджеты и глобальные фильтры",
    beta: true,
  },
  {
    href: "/plan",
    label: "План",
    icon: Target,
    hint: "План/факт по месяцам: выполнение, прогноз, светофор",
  },
  {
    href: "/ai-analysis",
    label: "AI-анализ",
    icon: Sparkles,
    hint: "Проекты AI-анализа",
  },
  {
    href: "/notifications",
    label: "Уведомления",
    icon: Bell,
    hint: "Telegram-алерты по правилам и расписанию",
    beta: true,
  },
  {
    href: "/settings",
    label: "Настройки",
    icon: Settings,
    hint: "Профиль и API-ключи",
  },
  {
    href: "/help",
    label: "Справка",
    icon: HelpCircle,
    hint: `Как устроены разделы ${BRAND_NAME}`,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { profile, isAdmin } = useAuth();
  const role = profile?.role;

  const baseItems = NAV.filter((item) => {
    if (!role) return true;
    if (!item.hideForRoles) return true;
    return !item.hideForRoles.includes(role);
  });
  // Пункт «Админка» — только админу (по серверной проверке ADMIN_EMAIL). Это лишь
  // показ кнопки; сама страница и API защищены на сервере отдельно.
  const items: NavItem[] = isAdmin
    ? [
        ...baseItems,
        {
          href: "/admin",
          label: "Админка",
          icon: ShieldCheck,
          hint: "Пользователи и обратная связь",
        },
      ]
    : baseItems;

  return (
    <aside
      className={cn(
        "relative flex h-screen shrink-0 flex-col border-r border-border bg-background/85 backdrop-blur-md transition-[width] duration-300 ease-out",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex items-center gap-3 px-4 py-5">
        <ArrowMark size={28} />
        {!collapsed && <ArrowWordmark />}
      </div>

      <div className="h-px bg-border" />

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-4">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 overflow-hidden rounded-md px-3 py-2.5 text-sm font-medium transition-colors duration-150",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
              title={collapsed ? item.label : undefined}
            >
              {active && (
                <span className="absolute inset-y-0 left-0 w-[2px] bg-brand-500" />
              )}
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  active
                    ? "text-brand-500"
                    : "text-muted-foreground group-hover:text-foreground",
                )}
              />
              {!collapsed && (
                <span className="truncate flex-1">{item.label}</span>
              )}
              {!collapsed && item.beta && (
                <span className="shrink-0 rounded bg-warning/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-warning">
                  Бета
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4" />
              <span>Свернуть</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
