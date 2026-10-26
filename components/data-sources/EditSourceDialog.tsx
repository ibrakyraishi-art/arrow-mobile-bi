"use client";

import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useDataSourceStore } from "@/stores/dataSourceStore";
import type { DataSource } from "@/lib/types";
import { Loader2, Save } from "lucide-react";

interface Props {
  /** Источник для редактирования; null — диалог закрыт. */
  source: DataSource | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Переименование / редактирование описания источника. Меняем только
 * метаданные (имя + описание) — креды подключения здесь не трогаем,
 * чтобы редактирование было безопасным для любого типа источника.
 */
export function EditSourceDialog({ source, onOpenChange }: Props) {
  const { toast } = useToast();
  const updateDataSource = useDataSourceStore((s) => s.updateDataSource);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Подхватываем значения при открытии (смене источника).
  useEffect(() => {
    if (source) {
      setName(source.name ?? "");
      setDescription(source.description ?? "");
    }
  }, [source]);

  async function save() {
    if (!source) return;
    if (!name.trim()) {
      toast({ title: "Введите название источника", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await updateDataSource(source.id, {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      toast({ title: "Источник обновлён", variant: "success" });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Не удалось сохранить",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!source} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Изменить источник</DialogTitle>
          <DialogDescription>
            Название и описание. Параметры подключения не меняются.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-src-name">
              Название <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-src-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Прод ClickHouse"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-src-desc">
              Описание{" "}
              <span className="text-xs font-normal text-muted-foreground">
                — необязательно
              </span>
            </Label>
            <Textarea
              id="edit-src-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Для чего этот источник: проект, клиент, среда, что внутри."
              className="min-h-[80px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button variant="gradient" onClick={save} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
