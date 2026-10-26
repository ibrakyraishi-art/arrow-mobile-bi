"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertCircle, Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addMonths } from "@/lib/plan";
import type { PlanProject } from "@/lib/types";
import { PlanTimeoutError, usePlanStore } from "@/stores/planStore";
import { cn } from "@/lib/utils";
import { formatPlanInput, parsePlanInput } from "./parse-number";
import { KIND_LABEL, errorText, monthShort, monthTitle } from "./plan-ui";

type SaveStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved"; at: number }
  | { state: "error"; message: string; timeout: boolean };

interface FailedSave {
  fieldId: string;
  month: string;
  value: number | null;
  message: string;
  timeout: boolean;
}

/** Статус по оставшимся ошибкам: причина — у последней несохранённой ячейки. */
function failedStatus(failed: Map<string, FailedSave>): SaveStatus | null {
  const last = [...failed.values()].at(-1);
  return last ? { state: "error", message: last.message, timeout: last.timeout } : null;
}

interface Props {
  project: PlanProject;
  /** Текущий месяц `YYYY-MM` (по Москве). */
  currentMonth: string;
  readOnly?: boolean;
  /** Вызывается после успешного сохранения значения (например, перезапросить отчёт). */
  onSaved?: () => void;
}

/**
 * Сетка «поле × месяц» как в Excel (история 22): текущий месяц ±3, «ещё месяц»
 * влево/вправо. Сохранение по уходу из ячейки или Enter (Enter — вниз, Tab —
 * вправо). Пустая ячейка = плана нет; нечисловое подсвечивается и не сохраняется.
 */
export function PlanGrid({ project, currentMonth, readOnly, onSaved }: Props) {
  const setValue = usePlanStore((s) => s.setValue);
  const [before, setBefore] = useState(3);
  const [after, setAfter] = useState(3);
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });
  const [invalidCount, setInvalidCount] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const pending = useRef(0);
  // Несохранённые ячейки (ошибка или таймаут) — для кнопки «Повторить».
  const failed = useRef(new Map<string, FailedSave>());
  const [failedCount, setFailedCount] = useState(0);

  const months = useMemo(() => {
    const out: string[] = [];
    for (let d = -before; d <= after; d++) out.push(addMonths(currentMonth, d));
    return out;
  }, [currentMonth, before, after]);

  const fields = useMemo(
    () => [...project.fields].sort((a, b) => a.sortOrder - b.sortOrder),
    [project.fields],
  );

  const save = useCallback(
    async (fieldId: string, month: string, value: number | null) => {
      const key = `${fieldId}:${month}`;
      pending.current += 1;
      setStatus({ state: "saving" });
      try {
        await setValue(fieldId, month, value);
        pending.current -= 1;
        failed.current.delete(key);
        setFailedCount(failed.current.size);
        if (pending.current === 0) {
          setStatus(failedStatus(failed.current) ?? { state: "saved", at: Date.now() });
        }
        onSaved?.();
        return true;
      } catch (e) {
        pending.current -= 1;
        // delete + set: свежая ошибка — последняя в порядке Map.
        failed.current.delete(key);
        failed.current.set(key, {
          fieldId,
          month,
          value,
          message: errorText(e),
          timeout: e instanceof PlanTimeoutError,
        });
        setFailedCount(failed.current.size);
        setStatus(failedStatus(failed.current) ?? { state: "idle" });
        return false;
      }
    },
    [setValue, onSaved],
  );

  const retryFailed = useCallback(() => {
    for (const f of [...failed.current.values()]) void save(f.fieldId, f.month, f.value);
  }, [save]);

  const focusCell = useCallback((row: number, col: number) => {
    const el = gridRef.current?.querySelector<HTMLInputElement>(
      `input[data-cell="${row}:${col}"]`,
    );
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const onInvalidChange = useCallback((delta: number) => {
    setInvalidCount((n) => Math.max(0, n + delta));
  }, []);

  if (fields.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Сначала добавьте поле плана — потом впишите план по месяцам.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {readOnly
            ? "Демо: значения только для просмотра."
            : "Впишите план на месяц. Enter или уход из ячейки — сохранить, Tab — дальше, пустая ячейка — плана нет. Можно «3 100 000,5»."}
        </p>
        <SaveIndicator
          status={status}
          invalidCount={invalidCount}
          failedCount={failedCount}
          onRetry={retryFailed}
        />
      </div>

      <div ref={gridRef} className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="bg-muted/40">
              <th className="sticky left-0 z-10 min-w-[180px] border-b border-r border-border bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                <div className="flex items-center justify-between gap-2">
                  <span>Поле</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[11px]"
                    onClick={() => setBefore((n) => n + 1)}
                    title="Показать месяц раньше"
                  >
                    <ChevronLeft />
                    ещё месяц
                  </Button>
                </div>
              </th>
              {months.map((m) => (
                <th
                  key={m}
                  title={monthTitle(m)}
                  className={cn(
                    "min-w-[120px] border-b border-r border-border px-3 py-2 text-right text-xs font-medium capitalize",
                    m === currentMonth
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {monthShort(m)}
                  {m === currentMonth && (
                    <span className="ml-1 normal-case text-[10px] text-primary">сейчас</span>
                  )}
                </th>
              ))}
              <th className="border-b border-border px-2 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px]"
                  onClick={() => setAfter((n) => n + 1)}
                  title="Показать месяц позже"
                >
                  ещё месяц
                  <ChevronRight />
                </Button>
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, row) => (
              <tr key={f.id} className="border-b border-border last:border-b-0">
                <th className="sticky left-0 z-10 border-r border-border bg-card px-3 py-1.5 text-left font-normal">
                  <div className="text-sm font-medium text-foreground">{f.label}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {KIND_LABEL[f.kind]} · {f.sourceColumn}
                  </div>
                </th>
                {months.map((m, col) => (
                  <td
                    key={m}
                    className={cn(
                      "border-r border-border p-0",
                      m === currentMonth && "bg-primary/5",
                    )}
                  >
                    <PlanCell
                      stored={project.values[f.id]?.[m] ?? null}
                      row={row}
                      col={col}
                      readOnly={readOnly}
                      label={`${f.label}, ${monthTitle(m)}`}
                      onCommit={(v) => save(f.id, m, v)}
                      onMove={(dr, dc) => focusCell(row + dr, col + dc)}
                      onInvalidChange={onInvalidChange}
                    />
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SaveIndicator({
  status,
  invalidCount,
  failedCount,
  onRetry,
}: {
  status: SaveStatus;
  invalidCount: number;
  failedCount: number;
  onRetry: () => void;
}) {
  if (invalidCount > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-bad" role="status">
        <AlertCircle className="h-3.5 w-3.5" />
        Не число — ячейка не сохранена ({invalidCount})
      </span>
    );
  }
  if (status.state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Сохраняем…
      </span>
    );
  }
  if (status.state === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ok" role="status">
        <Check className="h-3.5 w-3.5" />
        Сохранено
      </span>
    );
  }
  if (status.state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-bad" role="status">
        <AlertCircle className="h-3.5 w-3.5" />
        {status.timeout
          ? status.message
          : `Ошибка сохранения: ${status.message}`}
        {failedCount > 0 && (
          <Button variant="outline" size="sm" className="ml-1 h-6 px-2 text-[11px]" onClick={onRetry}>
            Повторить
          </Button>
        )}
      </span>
    );
  }
  return null;
}

interface CellProps {
  stored: number | null;
  row: number;
  col: number;
  readOnly?: boolean;
  label: string;
  onCommit: (value: number | null) => Promise<boolean>;
  onMove: (dRow: number, dCol: number) => void;
  onInvalidChange: (delta: number) => void;
}

function PlanCell({
  stored,
  row,
  col,
  readOnly,
  label,
  onCommit,
  onMove,
  onInvalidChange,
}: CellProps) {
  // draft === null — ячейку не правят, показываем сохранённое значение.
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState(false);
  // Ref-зеркала: blur после Enter приходит в том же тике, до перерисовки, —
  // без них значение ушло бы на сохранение дважды.
  const draftRef = useRef<string | null>(null);
  const invalidRef = useRef(false);

  const updateDraft = (next: string | null) => {
    draftRef.current = next;
    setDraft(next);
  };
  const markInvalid = (next: boolean) => {
    if (next !== invalidRef.current) onInvalidChange(next ? 1 : -1);
    invalidRef.current = next;
    setInvalid(next);
  };

  // Повтор из строки статуса сохранил введённое значение — показываем стор.
  useEffect(() => {
    if (!failed || draftRef.current === null) return;
    const parsed = parsePlanInput(draftRef.current);
    if (parsed.ok && parsed.value === stored) {
      updateDraft(null);
      setFailed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- реагируем только на новое сохранённое значение
  }, [stored]);

  // Ячейка с ошибкой исчезла (удалили поле) — снять её со счётчика.
  useEffect(
    () => () => {
      if (invalidRef.current) onInvalidChange(-1);
    },
    [onInvalidChange],
  );

  function commit(): boolean {
    const current = draftRef.current;
    if (current === null) return true;
    const parsed = parsePlanInput(current);
    if (!parsed.ok) {
      markInvalid(true);
      return false;
    }
    markInvalid(false);
    updateDraft(null);
    if (parsed.value !== stored) {
      setFailed(false);
      void onCommit(parsed.value).then((ok) => {
        setFailed(!ok);
        // Не сохранилось — ячейка остаётся с введённым значением (стор откатил
        // своё), чтобы его можно было повторить, а не набирать заново.
        if (!ok && draftRef.current === null) updateDraft(current);
      });
    }
    return true;
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (commit()) onMove(e.shiftKey ? -1 : 1, 0);
    } else if (e.key === "Escape") {
      e.preventDefault();
      markInvalid(false);
      updateDraft(null);
      e.currentTarget.blur();
    }
  }

  const text = draft ?? formatPlanInput(stored);

  return (
    <input
      type="text"
      inputMode="decimal"
      data-cell={`${row}:${col}`}
      aria-label={label}
      aria-invalid={invalid || undefined}
      title={invalid ? "Не число — значение не сохранено" : failed ? "Не сохранилось" : undefined}
      readOnly={readOnly}
      value={text}
      placeholder={readOnly ? "—" : ""}
      onFocus={(e) => {
        if (readOnly) return;
        if (draftRef.current === null) updateDraft(formatPlanInput(stored));
        e.currentTarget.select();
      }}
      onChange={(e) => {
        updateDraft(e.target.value);
        if (invalid && parsePlanInput(e.target.value).ok) markInvalid(false);
      }}
      onBlur={() => {
        if (!readOnly) commit();
      }}
      onKeyDown={readOnly ? undefined : onKeyDown}
      className={cn(
        "h-9 w-full bg-transparent px-3 text-right tabular-nums outline-none transition-colors",
        "placeholder:text-muted-foreground/50 focus:bg-background focus:ring-2 focus:ring-inset focus:ring-ring",
        readOnly && "cursor-default text-muted-foreground focus:ring-0",
        invalid && "bg-bad/10 text-bad ring-2 ring-inset ring-bad focus:ring-bad",
        failed && !invalid && "bg-bad/5 ring-1 ring-inset ring-bad/60",
      )}
    />
  );
}
