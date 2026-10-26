"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ChevronDown,
  Loader2,
  RefreshCw,
  RotateCw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { EmptyState } from "@/components/layout/PageContainer";
import { cn } from "@/lib/utils";
import type { AlertRule, AlertRun } from "@/lib/types";

interface Props {
  refreshKey?: number;
}

export function RunsTab({ refreshKey }: Props) {
  const { toast } = useToast();
  const [runs, setRuns] = useState<AlertRun[] | null>(null);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [busyRetry, setBusyRetry] = useState<string | null>(null);

  const [ruleFilter, setRuleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (ruleFilter !== "all") params.set("ruleId", ruleFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (from) params.set("from", `${from}T00:00:00Z`);
    if (to) params.set("to", `${to}T23:59:59Z`);
    try {
      const [runsRes, rulesRes] = await Promise.all([
        fetch(`/api/alert-runs?${params.toString()}`, { cache: "no-store" }),
        fetch("/api/alert-rules", { cache: "no-store" }),
      ]);
      const runsJson = await runsRes.json();
      const rulesJson = await rulesRes.json();
      if (!runsRes.ok)
        throw new Error(runsJson.error ?? `HTTP ${runsRes.status}`);
      setRuns((runsJson.runs as AlertRun[]) ?? []);
      setRules((rulesJson.rules as AlertRule[]) ?? []);
    } catch (e) {
      toast({
        title: "Не удалось загрузить историю",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      setRuns([]);
    }
  }, [ruleFilter, statusFilter, from, to, toast]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function onRetry(run: AlertRun) {
    if (!run.ruleId) return;
    setBusyRetry(run.id);
    try {
      const res = await fetch(`/api/alert-rules/${run.ruleId}/run`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast({ title: "Запущено", variant: "success" });
      await load();
    } catch (e) {
      toast({
        title: "Не удалось перезапустить",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusyRetry(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="space-y-1">
              <Label>Правило</Label>
              <Select value={ruleFilter} onValueChange={setRuleFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  {rules.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Статус</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="ok">ok</SelectItem>
                  <SelectItem value="error">error</SelectItem>
                  <SelectItem value="no_match">no_match</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>С</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>По</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={() => void load()} className="w-full">
                <RefreshCw />
                Обновить
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {runs === null ? (
        <Card>
          <CardContent className="flex items-center gap-3 pt-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка…
          </CardContent>
        </Card>
      ) : runs.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-6 w-6" />}
          title="Нет срабатываний"
          description="История появится после первого запуска правила (вручную или по расписанию)."
        />
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              busy={busyRetry === run.id}
              onRetry={() => onRetry(run)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunRow({
  run,
  busy,
  onRetry,
}: {
  run: AlertRun;
  busy: boolean;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);

  const statusBadge = useMemo(() => {
    if (run.status === "ok")
      return <Badge variant="success">ok</Badge>;
    if (run.status === "error")
      return <Badge variant="destructive">error</Badge>;
    return <Badge variant="outline">no_match</Badge>;
  }, [run.status]);

  return (
    <Card>
      <CardContent className="space-y-2 pt-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 text-left"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              !open && "-rotate-90",
            )}
          />
          <div className="flex-1 grid grid-cols-1 gap-1 md:grid-cols-[180px_1fr_120px_140px_80px] md:items-center">
            <div className="font-mono text-xs text-muted-foreground">
              {formatDate(run.createdAt)}
            </div>
            <div className="font-medium">{run.ruleName}</div>
            <div>{statusBadge}</div>
            <div className="text-xs text-muted-foreground">
              Объектов: {run.matchedCount}
              {run.usedAi ? " · AI" : ""}
            </div>
            <div className="text-xs text-muted-foreground">
              {run.durationMs} ms
            </div>
          </div>
        </button>
        {open && (
          <div className="space-y-3 border-t border-border pt-3 text-sm">
            {run.message && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground">
                  Сообщение
                </div>
                <pre className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2 text-xs">
                  {run.message}
                </pre>
              </div>
            )}
            {run.aiRecommendation && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground">
                  AI-рекомендация
                </div>
                <pre className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2 text-xs">
                  {run.aiRecommendation}
                </pre>
              </div>
            )}
            {run.errorText && (
              <div>
                <div className="text-xs font-semibold text-destructive">
                  Ошибка
                </div>
                <pre className="mt-1 whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  {run.errorText}
                </pre>
              </div>
            )}
            {run.matchedObjects.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground">
                  Найденные объекты
                </div>
                <pre className="mt-1 max-h-72 overflow-auto whitespace-pre rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px]">
                  {JSON.stringify(run.matchedObjects, null, 2)}
                </pre>
              </div>
            )}
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                disabled={busy}
              >
                {busy ? <Loader2 className="animate-spin" /> : <RotateCw />}
                Повторить
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
