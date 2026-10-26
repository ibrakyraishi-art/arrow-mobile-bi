"use client";

import { useState } from "react";
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
import { useDashboardStore } from "@/stores/dashboardStore";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateDashboardDialog({ open, onOpenChange }: Props) {
  const datasets = useDatasetStore((s) => s.datasets);
  const createDashboard = useDashboardStore((s) => s.createDashboard);
  const { toast } = useToast();
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [datasetId, setDatasetId] = useState(datasets[0]?.id ?? "");
  const [saving, setSaving] = useState(false);

  function reset() {
    setName("");
    setDescription("");
    setDatasetId(datasets[0]?.id ?? "");
  }

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
      const created = await createDashboard({
        datasetId,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      toast({ title: "Дашборд создан", variant: "success" });
      onOpenChange(false);
      reset();
      router.push(`/dashboards/${created.id}`);
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
          <DialogTitle>Новый дашборд</DialogTitle>
          <DialogDescription>
            Один дашборд привязан к одному датасету. После создания можно
            настроить глобальные фильтры и добавить виджеты.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dash-name">Название</Label>
            <Input
              id="dash-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Performance Overview"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dash-desc">Описание</Label>
            <Textarea
              id="dash-desc"
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
            onClick={() => {
              onOpenChange(false);
              reset();
            }}
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
