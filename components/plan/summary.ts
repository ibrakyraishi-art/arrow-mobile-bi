"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlanSummaryResponse } from "@/lib/plan";

export type { PlanSummaryField, PlanSummaryResponse } from "@/lib/plan";

export interface PlanSummaryState {
  data: PlanSummaryResponse | null;
  loading: boolean;
  /** Ошибка запроса (HTTP/сеть). Ошибка источника — в `data.error`. */
  error: string | null;
  reload: () => void;
}

async function fetchSummary(projectId: string, month: string): Promise<PlanSummaryResponse> {
  const res = await fetch(
    `/api/plan/${encodeURIComponent(projectId)}/summary?month=${encodeURIComponent(month)}`,
    { cache: "no-store" },
  );
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null; // не JSON (например, страница 404 до появления эндпоинта)
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : res.status === 404
          ? "План-проект не найден или сводка ещё недоступна"
          : res.status === 401
            ? "Нужно войти в систему"
            : `Ошибка сервера (HTTP ${res.status})`;
    throw new Error(msg);
  }
  if (!body || typeof body !== "object" || !Array.isArray((body as PlanSummaryResponse).fields)) {
    throw new Error("Сводка плана пришла в неожиданном формате");
  }
  return body as PlanSummaryResponse;
}

/**
 * Сводка плана за месяц. `refreshKey` — любой ключ, при смене которого сводку
 * надо перезапросить (например, после правки плана в сетке).
 */
export function usePlanSummary(
  projectId: string | null | undefined,
  month: string,
  refreshKey: string | number = 0,
): PlanSummaryState {
  const [data, setData] = useState<PlanSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSummary(projectId, month)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setData(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, month, refreshKey, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}
