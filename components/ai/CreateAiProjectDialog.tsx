"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDatasetStore } from "@/stores/datasetStore";
import { useAiProjectStore } from "@/stores/aiProjectStore";
import { DEMO_DATASET_ID } from "@/lib/demo-data";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateAiProjectDialog({ open, onOpenChange }: Props) {
  const datasets = useDatasetStore((s) => s.datasets);
  const createProject = useAiProjectStore((s) => s.createProject);
  const { toast } = useToast();
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      // По умолчанию — первый не-демо датасет, иначе демо.
      const first = datasets.find((d) => d.id !== DEMO_DATASET_ID);
      setDatasetId(first?.id ?? datasets[0]?.id ?? "");
    }
  }, [open, datasets]);

  async function onSubmit() {
    if (!name.trim()) {
      toast({ title: "Введите название", variant: "destructive" });
      return;
    }
    if (!datasetId) {
      toast({ title: "Выберите датасет", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const created = await createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        datasetId,
      });
      toast({ title: "Проект создан", variant: "success" });
      onOpenChange(false);
      router.push(`/ai-analysis/${created.id}`);
    } catch (e) {
      toast({
        title: "Ошибка создания",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новый AI-проект</DialogTitle>
          <DialogDescription>
            Проект содержит настройки фильтров, модели и промпта, а также
            историю запусков. После создания можно будет добавить фильтры и
            запустить анализ.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="proj-name">Название</Label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Анализ креативов TikTok"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-desc">Описание</Label>
            <Textarea
              id="proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Опционально"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Датасет</Label>
            <Select value={datasetId} onValueChange={setDatasetId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите датасет" />
              </SelectTrigger>
              <SelectContent>
                {datasets.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Отмена
          </Button>
          <Button variant="gradient" onClick={onSubmit} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
