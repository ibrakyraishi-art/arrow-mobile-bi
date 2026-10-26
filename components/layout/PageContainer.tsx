"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageContainerProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}

export function PageContainer({
  title,
  description,
  actions,
  children,
  className,
  icon,
}: PageContainerProps) {
  return (
    <div className={cn("flex-1 overflow-auto", className)}>
      <div className="mx-auto max-w-[1400px] p-6 lg:p-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4 animate-fade-in">
          <div className="flex items-start gap-3">
            {icon && (
              <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-gradient-to-br from-card to-muted/30 text-primary shadow-sm">
                {icon}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {title}
              </h1>
              {description && (
                <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
                  {description}
                </p>
              )}
            </div>
          </div>
          {actions && (
            <div className="flex items-center gap-2">{actions}</div>
          )}
        </div>
        <div className="animate-fade-in">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-card/30 p-12 text-center">
      {icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-muted/50 to-muted/20 text-muted-foreground border border-border">
          {icon}
        </div>
      )}
      <div className="max-w-md space-y-1.5">
        <h3 className="text-base font-semibold">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function DemoBanner() {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-lg border border-warning/30 bg-gradient-to-r from-warning/10 via-warning/5 to-transparent p-3 text-sm">
      <span className="mt-0.5 text-base">⚡</span>
      <div>
        <div className="font-medium text-foreground">Демо-режим</div>
        <div className="text-muted-foreground">
          Отображаются тестовые данные. Подключите ClickHouse для работы с
          реальными данными.
        </div>
      </div>
    </div>
  );
}
