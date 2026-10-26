"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useDatasetStore } from "@/stores/datasetStore";
import { usePlanStore } from "@/stores/planStore";
import { canCreatePlanProject } from "@/lib/plan";
import { DEMO_SAVE_HINT_HREF } from "@/lib/demo-data";
import { DEMO_PLAN_DATASET_ID } from "@/lib/plan/demo-project";
import type { PlanProject } from "@/lib/types";
import { dateColumnsOf, errorText } from "./plan-ui";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Есть — редактирование; нет — создание. */
  project?: PlanProject;
  onSaved?: (project: PlanProject) => void;
}

/** Создание / редактирование план-проекта: имя, датасет, колонка даты (история 20). */
export function PlanProjectDialog({ open, onOpenChange, project, onSaved }: Props) {
  const datasets = useDatasetStore((s) => s.datasets);
  const createProject = usePlanStore((s) => s.createProject);
  const updateProject = usePlanStore((s) => s.updateProject);
  const projects = usePlanStore((s) => s.projects);
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [dateColumn, setDateColumn] = useState("");
  const [saving, setSaving] = useState(false);

  // Каждое открытие — свежая форма из проекта (или пустая).
  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? "");
    setDatasetId(project?.datasetId ?? "");
    setDateColumn(project?.dateColumn ?? "");
  }, [open, project]);

  const dataset = datasets.find((d) => d.id === datasetId);
  const dateColumns = useMemo(() => dateColumnsOf(dataset), [dataset]);

  // Одна колонка даты — выбираем сами; выбранная пропала — сбрасываем.
  useEffect(() => {
    if (!dataset) return;
    if (dateColumns.length === 1 && !dateColumn) setDateColumn(dateColumns[0].name);
    if (dateColumn && !dateColumns.some((c) => c.name === dateColumn)) setDateColumn("");
  }, [dataset, dateColumns, dateColumn]);

  // «Проект = датасет целиком» (Q6): занятый другим проектом датасет недоступен.
  // Правке проекта на прежнем датасете запрет не мешает.
  const takenBy = (id: string) => {
    const check = canCreatePlanProject(projects, id, project);
    return check.ok ? undefined : check.existing;
  };
  const blocking = datasetId ? takenBy(datasetId) : undefined;

  const datasetChanged = Boolean(project && datasetId && datasetId !== project.datasetId);
  const canSave = Boolean(name.trim() && datasetId && dateColumn) && !blocking && !saving;

  async function onSubmit() {
    if (!canSave) return;
    setSaving(true);
    try {
      const saved = project
        ? await updateProject(project.id, { name: name.trim(), datasetId, dateColumn })
        : await createProject({ name: name.trim(), datasetId, dateColumn });
      toast({ title: project ? "План-проект сохранён" : "План-проект создан", variant: "success" });
      onOpenChange(false);
      onSaved?.(saved);
    } catch (e) {
      toast({
        title: project ? "Не удалось сохранить" : "Не удалось создать",
        description: errorText(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{project ? "Настройки план-проекта" : "Новый план-проект"}</DialogTitle>
          <DialogDescription>
            Проект = один датасет (обычно один клиент, например «Яндекс» или «Sun») и колонка
            даты, по которой план раскладывается по дням.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="plan-name">Название</Label>
            <Input
              id="plan-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Яндекс — 2026"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Датасет</Label>
            <Select value={datasetId} onValueChange={setDatasetId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите датасет" />
              </SelectTrigger>
              <SelectContent>
                {datasets.map((d) => {
                  const taken = takenBy(d.id);
                  return (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                      {taken && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          уже есть проект «{taken.name}»
                        </span>
                      )}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {datasets.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Датасетов пока нет — создайте его в разделе{" "}
                <Link
                  href="/datasets"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => onOpenChange(false)}
                >
                  «Датасеты»
                </Link>
                .
              </p>
            )}
            {datasetId === DEMO_PLAN_DATASET_ID && !blocking && (
              <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-foreground">
                Это демо-датасет: на нём можно потренироваться с планом, но свой дашборд
                план/факт на нём не собрать — кнопка откроет готовый демо-дашборд. Для своих цифр{" "}
                <Link
                  href={DEMO_SAVE_HINT_HREF}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => onOpenChange(false)}
                >
                  загрузите CSV как источник
                </Link>
                .
              </p>
            )}
            {blocking && (
              <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-foreground">
                У этого датасета уже есть проект «{blocking.name}» — один датасет, один проект.{" "}
                <Link
                  href={`/plan/${blocking.id}`}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => onOpenChange(false)}
                >
                  Открыть
                </Link>
              </p>
            )}
            {datasetChanged && !blocking && (
              <p className="text-xs text-warn">
                Поля плана ссылаются на метрики прежнего датасета — проверьте их после смены.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Колонка даты</Label>
            {datasetId && dateColumns.length === 0 ? (
              <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-foreground">
                В этом датасете нет колонок с типом «дата» или «дата и время». Откройте датасет и
                поменяйте тип колонки с датой — без неё план не разложить по дням.
              </p>
            ) : (
              <Select value={dateColumn} onValueChange={setDateColumn} disabled={!datasetId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={datasetId ? "Выберите колонку даты" : "Сначала выберите датасет"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {dateColumns.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.name}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {c.datasetType === "date" ? "дата" : "дата и время"}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={() => void onSubmit()} disabled={!canSave}>
            {saving && <Loader2 className="animate-spin" />}
            {project ? "Сохранить" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
