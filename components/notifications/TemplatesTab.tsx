"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ChevronDown,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Table2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { EmptyState } from "@/components/layout/PageContainer";
import {
  AVAILABLE_VARIABLES,
  buildDatasetVariableGroups,
  PREVIEW_VALUES,
  TemplatePreview,
} from "@/components/notifications/template-helpers";
import { useDatasetStore } from "@/stores/datasetStore";
import { cn } from "@/lib/utils";
import type { NotificationTemplate } from "@/lib/types";

const LAST_DATASET_LS_KEY = "tpl-editor:lastDatasetId";

/**
 * Дефолтное тело нового шаблона — структура под подход {table}:
 * заголовок одной строкой → таблица из конструктора → короткий вывод.
 */
const DEFAULT_TEMPLATE_BODY = `📊 Отчёт за {period_label}

{table}

Проверьте строки выше и примите решение.`;

interface Props {
  refreshKey?: number;
}

export function TemplatesTab({ refreshKey }: Props) {
  const { toast } = useToast();
  const [items, setItems] = useState<NotificationTemplate[] | null>(null);
  const [editing, setEditing] = useState<NotificationTemplate | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/notification-templates", {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setItems(json.templates as NotificationTemplate[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  function onCreate() {
    setEditing(null);
    setOpen(true);
  }

  function onEdit(t: NotificationTemplate) {
    setEditing(t);
    setOpen(true);
  }

  async function onDelete(t: NotificationTemplate) {
    if (!confirm(`Удалить шаблон «${t.name}»?`)) return;
    try {
      const res = await fetch(`/api/notification-templates/${t.id}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast({ title: "Шаблон удалён", variant: "success" });
      await load();
    } catch (e) {
      toast({
        title: "Не удалось удалить",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
          Шаблон может включать переменные вида{" "}
          <code className="font-mono text-xs">{"{creative_name}"}</code>,{" "}
          <code className="font-mono text-xs">{"{roas}"}</code>,{" "}
          <code className="font-mono text-xs">{"{top_objects}"}</code>.
          Они подставляются в момент срабатывания правила.
        </div>
        <Button variant="gradient" onClick={onCreate}>
          <Plus />
          Новый шаблон
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6 text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      {items === null ? (
        <Card>
          <CardContent className="flex items-center gap-3 pt-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка…
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title="Нет шаблонов"
          description="Создайте шаблон сообщения с переменными — он будет использоваться правилами для отправки в Telegram."
          action={
            <Button variant="outline" onClick={onCreate}>
              <Plus />
              Новый шаблон
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((t) => (
            <Card key={t.id} className="overflow-hidden">
              <CardContent className="space-y-2 pt-6">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold">{t.name}</div>
                </div>
                <div className="line-clamp-2 whitespace-pre-wrap rounded-md bg-muted/30 p-2 font-mono text-xs text-muted-foreground">
                  {t.body.slice(0, 200)}
                  {t.body.length > 200 ? "…" : ""}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => onEdit(t)}>
                    <Pencil />
                    Редактировать
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(t)}
                  >
                    <Trash2 />
                    Удалить
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TemplateEditorDialog
        open={open}
        onOpenChange={setOpen}
        template={editing}
        onSaved={() => {
          setOpen(false);
          void load();
        }}
      />
    </div>
  );
}

export function TemplateEditorDialog({
  open,
  onOpenChange,
  template,
  onSaved,
  /**
   * Опциональный датасет «по контексту»: когда диалог открыт из формы
   * правила — сюда подставляется выбранный там dataset, и переменные
   * автоматически расширяются его колонками + calc-полями.
   * Если не передан — селектор работает сам, последний выбор запоминается.
   */
  defaultDatasetId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template: NotificationTemplate | null;
  onSaved: (t: NotificationTemplate) => void;
  defaultDatasetId?: string;
}) {
  const { toast } = useToast();
  const datasets = useDatasetStore((s) => s.datasets);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [datasetId, setDatasetId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [varsOpen, setVarsOpen] = useState(false);
  // Список правил пользователя — для вставки таблиц других правил ({table:Имя}).
  const [ruleNames, setRuleNames] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) {
      setName(template?.name ?? "");
      setBody(template?.body ?? DEFAULT_TEMPLATE_BODY);
      setVarsOpen(false);
      // Выбор датасета: явный prop > последний из localStorage > первый из списка.
      let initial = defaultDatasetId ?? "";
      if (!initial && typeof window !== "undefined") {
        initial = window.localStorage.getItem(LAST_DATASET_LS_KEY) ?? "";
      }
      if (initial && !datasets.some((d) => d.id === initial)) initial = "";
      if (!initial) initial = datasets[0]?.id ?? "";
      setDatasetId(initial);
    }
  }, [open, template, defaultDatasetId, datasets]);

  // Запоминаем последний выбранный датасет — чтобы открывая шаблон снова
  // байер не выбирал его заново.
  useEffect(() => {
    if (!open || !datasetId) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_DATASET_LS_KEY, datasetId);
  }, [open, datasetId]);

  // Подгружаем имена правил — чтобы вставлять их таблицы как {table:Имя}.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/alert-rules", { cache: "no-store" });
        const json = await res.json();
        if (cancelled || !res.ok) return;
        const names = ((json.rules as { name: string }[]) ?? [])
          .map((r) => r.name)
          .filter((n) => n && n.trim());
        setRuleNames(Array.from(new Set(names)));
      } catch {
        // тихо — секция «таблицы правил» просто не покажется
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const selectedDataset = datasets.find((d) => d.id === datasetId);
  const datasetGroups = buildDatasetVariableGroups(selectedDataset);
  // Все переменные, КРОМЕ {table} — она вынесена в отдельную большую кнопку.
  const otherGroups = [...AVAILABLE_VARIABLES, ...datasetGroups]
    .map((g) => ({
      ...g,
      items: g.items.filter((v) => v.name !== "table"),
    }))
    .filter((g) => g.items.length > 0);

  function insertVar(name: string) {
    const ta = textareaRef.current;
    const token = `{${name}}`;
    if (!ta) {
      setBody((b) => b + token);
      return;
    }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    queueMicrotask(() => {
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const url = template
        ? `/api/notification-templates/${template.id}`
        : "/api/notification-templates";
      const method = template ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          body,
          // Новые шаблоны — HTML: {table} уходит в Telegram как <pre> code-block,
          // а обычный текст (эмодзи, точки, запятые) не требует экранирования.
          ...(template ? {} : { parseMode: "html" }),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast({ title: "Шаблон сохранён", variant: "success" });
      onSaved(json.template as NotificationTemplate);
    } catch (e) {
      toast({
        title: "Не удалось сохранить",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {template ? "Редактирование шаблона" : "Новый шаблон"}
          </DialogTitle>
          <DialogDescription>
            Это текст письма в Telegram. Главное — кнопка «Вставить таблицу
            отчёта» справа: на её место встанет таблица того правила, которое
            использует этот шаблон. Один шаблон можно навесить на разные
            правила.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tpl-name">Название</Label>
            <Input
              id="tpl-name"
              placeholder="Например, ROAS под порогом"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-2">
              <Label>
                Датасет{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  — для подсказки переменных
                </span>
              </Label>
              <Select
                value={datasetId}
                onValueChange={setDatasetId}
                disabled={datasets.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      datasets.length === 0
                        ? "Нет датасетов"
                        : "Выберите датасет"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Шаблон не привязан к датасету — выбор влияет только на список
                переменных справа.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px]">
            <div className="space-y-2">
              <Label htmlFor="tpl-body">Текст сообщения</Label>
              <Textarea
                id="tpl-body"
                ref={textareaRef}
                rows={10}
                placeholder={
                  "🚨 Отчёт за {period_label}\n\n{table}\n\n{tag_users}"
                }
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Что вставить</Label>

              {/* Главное: таблица отчёта — большая понятная кнопка. */}
              <button
                type="button"
                onClick={() => insertVar("table")}
                className="flex w-full items-start gap-2 rounded-md border border-brand-500/50 bg-brand-500/10 p-2 text-left hover:border-brand-500 hover:bg-brand-500/15"
              >
                <Table2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                <span>
                  <span className="block text-xs font-semibold text-foreground">
                    Вставить таблицу отчёта
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    Сюда встанет таблица правила, которое отправляет это
                    сообщение (это переменная{" "}
                    <code className="font-mono">{"{table}"}</code>).
                  </span>
                </span>
              </button>

              {/* Таблицы конкретных правил — для сводного сообщения. */}
              {ruleNames.length > 0 && (
                <div className="space-y-1 rounded-md border border-border bg-muted/20 p-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Таблицы правил
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Вставьте отчёт конкретного правила — можно собрать несколько
                    в одном сообщении.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {ruleNames.map((rn) => (
                      <button
                        type="button"
                        key={rn}
                        onClick={() => insertVar(`table:${rn}`)}
                        className="max-w-full truncate rounded border border-border bg-background px-2 py-0.5 font-mono text-[11px] hover:border-brand-500 hover:text-brand-500"
                        title={`Вставить таблицу правила «${rn}»`}
                      >
                        {`{table:${rn}}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Технические переменные — спрятаны, чтобы не пугать. */}
              <button
                type="button"
                onClick={() => setVarsOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-md px-1 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <span>
                  Другие переменные (имя, период, теги, колонки…)
                </span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    varsOpen && "rotate-180",
                  )}
                />
              </button>

              {varsOpen && (
                <div className="max-h-[320px] space-y-3 overflow-y-auto rounded-md border border-border bg-muted/20 p-2">
                  {otherGroups.map((group) => (
                    <div key={group.title} className="space-y-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {group.title}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {group.items.map((v) => (
                          <button
                            type="button"
                            key={v.name}
                            onClick={() => insertVar(v.name)}
                            className="rounded border border-border bg-background px-2 py-0.5 font-mono text-[11px] hover:border-foreground/40 hover:bg-accent"
                            title={v.description}
                          >
                            {`{${v.name}}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {datasetGroups.length === 0 && selectedDataset && (
                    <div className="text-[11px] text-muted-foreground">
                      В выбранном датасете нет колонок с валидными именами для
                      подстановки.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Превью</Label>
            <TemplatePreview
              body={body}
              parseMode="none"
              values={PREVIEW_VALUES}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Отмена
            </Button>
            <Button type="submit" variant="gradient" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="animate-spin" />
                  Сохранение…
                </>
              ) : (
                <>Сохранить</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
