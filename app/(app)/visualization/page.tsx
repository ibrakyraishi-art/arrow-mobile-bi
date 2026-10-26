"use client";

import Link from "next/link";
import { PageContainer, EmptyState } from "@/components/layout/PageContainer";
import { TabIntro } from "@/components/layout/TabIntro";
import { Button } from "@/components/ui/button";
import { useVisualizationStore } from "@/stores/visualizationStore";
import { VisualizationCard } from "@/components/visualization/VisualizationCard";
import { BarChart3, Plus } from "lucide-react";
import type { Visualization } from "@/lib/types";
import { useToast } from "@/components/ui/use-toast";
import { LoadingState } from "@/components/layout/LoadingState";

export default function VisualizationListPage() {
  const visualizations = useVisualizationStore((s) => s.visualizations);
  const loaded = useVisualizationStore((s) => s.loaded);
  const loading = useVisualizationStore((s) => s.loading);
  const remove = useVisualizationStore((s) => s.removeVisualization);
  const { toast } = useToast();

  async function onDelete(v: Visualization) {
    if (!confirm(`Удалить визуализацию "${v.name}"?`)) return;
    try {
      await remove(v.id);
      toast({ title: "Визуализация удалена" });
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
      icon={<BarChart3 className="h-5 w-5" />}
      title="Графики"
      description="Сводные таблицы, графики и диаграммы на основе ваших датасетов."
      actions={
        <Button asChild variant="gradient">
          <Link href="/visualization/new">
            <Plus />
            Создать визуализацию
          </Link>
        </Button>
      }
    >
      <TabIntro
        beta
        lead="Сводные таблицы, графики и диаграммы на основе ваших датасетов."
        points={[
          { title: "Для чего", text: "Быстро посмотреть данные срезами: сводная, столбцы, линия, кольцо, комбо «факт + план», прогресс к плану." },
          { title: "Как создать", text: "«Создать визуализацию» → выберите датасет, меру и разрез (ось / серии / строки). Если для датасета заведён план в разделе «План», в списке полей появится группа «План»: план, план на дату, выполнение %, прогноз, отклонение." },
          { title: "Дальше", text: "Сохраните график, затем в дашборде «Добавить виджет» → «Визуализация» — он появится на дашборде." },
        ]}
      />

      {showSkeleton ? (
        <LoadingState label="Загружаем визуализации…" />
      ) : visualizations.length === 0 ? (
        <EmptyState
          icon={<BarChart3 className="h-6 w-6" />}
          title="Нет визуализаций"
          description="Создайте первую сводную таблицу или график на основе датасета."
          action={
            <Button asChild variant="gradient">
              <Link href="/visualization/new">
                <Plus />
                Создать визуализацию
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {visualizations.map((v) => (
            <VisualizationCard key={v.id} viz={v} onDelete={onDelete} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
