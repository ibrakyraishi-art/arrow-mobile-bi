"use client";

import type { DataSource } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, CircleDashed } from "lucide-react";

export function StatusBadge({ status }: { status: DataSource["status"] }) {
  if (status === "connected") {
    return (
      <Badge variant="success" className="gap-1.5">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
        Подключён
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="destructive" className="gap-1.5">
        <AlertCircle className="h-3 w-3" />
        Ошибка
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1.5">
      <CircleDashed className="h-3 w-3" />
      Неизвестно
    </Badge>
  );
}

export function InlineStatus({
  status,
  message,
}: {
  status: "idle" | "testing" | "success" | "error";
  message?: string;
}) {
  if (status === "idle") return null;
  if (status === "testing") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        Проверяем подключение…
      </div>
    );
  }
  if (status === "success") {
    return (
      <div className="flex items-center gap-2 text-sm text-success">
        <CheckCircle2 className="h-4 w-4" />
        Подключение успешно
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 text-sm text-destructive">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
      <span className="break-all">{message ?? "Ошибка подключения"}</span>
    </div>
  );
}
