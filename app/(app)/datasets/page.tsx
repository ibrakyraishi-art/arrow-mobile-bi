"use client";

import Link from "next/link";
import { PageContainer, EmptyState } from "@/components/layout/PageContainer";
import { TabIntro } from "@/components/layout/TabIntro";
import { Button } from "@/components/ui/button";
import { useDatasetStore } from "@/stores/datasetStore";
import { DatasetCard } from "@/components/datasets/DatasetCard";
import { LayoutGrid, Plus } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import type { Dataset } from "@/lib/types";
import { LoadingState } from "@/components/layout/LoadingState";
import { useAuth } from "@/lib/auth-context";
import { logAudit } from "@/lib/audit";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function DatasetsPage() {
  const datasets = useDatasetStore((s) => s.datasets);
  const loaded = useDatasetStore((s) => s.loaded);
  const loading = useDatasetStore((s) => s.loading);
  const removeDataset = useDatasetStore((s) => s.removeDataset);
  const { toast } = useToast();
  const { user } = useAuth();

  async function handleDelete(d: Dataset) {
    if (!confirm(`Удалить датасет "${d.name}"?`)) return;
    try {
      await removeDataset(d.id);
      if (user) {
        void logAudit(
          getSupabaseBrowserClient(),
          user.id,
          "dataset_deleted",
          "dataset",
          d.id,
          { name: d.name },
        );
      }
      toast({ title: "Датасет удалён", variant: "default" });
    } catch (e) {
      toast({
        title: "Ошибка удаления",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  const showSkeleton = !loaded || loading;

  return (
    <PageContainer
      icon={<LayoutGrid className="h-5 w-5" />}
      title="Датасеты"
      description="Сохранённые конфигурации таблиц с типизированными столбцами для визуализации и AI-анализа."
      actions={
        <Button asChild variant="gradient">
          <Link href="/datasets/new">
            <Plus />
            Создать датасет
          </Link>
        </Button>
      }
    >
      <TabIntro
        lead="«Таблицы» с типизированными столбцами — основа для визуализаций и AI-анализа."
        points={[
          { title: "Для чего", text: "Датасет фиксирует, какие столбцы и какого типа берутся из источника, плюс бизнес-контекст и вычисляемые поля." },
          { title: "Как создать", text: "«Создать датасет» → выберите источник и таблицу или SQL, проверьте типы столбцов." },
          { title: "Вычисляемые поля", text: "Добавьте формулы с именами ваших колонок в скобках, например CPI = SUM([spend_rub]) / SUM([installs]), и формат (число, %, ₽, $) — они станут доступны в графиках, плане и AI." },
        ]}
      />

      {showSkeleton ? (
        <LoadingState label="Загружаем датасеты…" />
      ) : datasets.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="h-6 w-6" />}
          title="Нет датасетов"
          description="Создайте первый датасет на основе подключённого источника данных."
          action={
            <Button asChild variant="gradient">
              <Link href="/datasets/new">
                <Plus />
                Создать датасет
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {datasets.map((d) => (
            <DatasetCard key={d.id} dataset={d} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
