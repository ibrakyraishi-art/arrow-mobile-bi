"use client";

import { useState } from "react";
import { LayoutDashboard, Plus } from "lucide-react";
import { PageContainer, EmptyState } from "@/components/layout/PageContainer";
import { TabIntro } from "@/components/layout/TabIntro";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/layout/LoadingState";
import { useToast } from "@/components/ui/use-toast";
import { DashboardCard } from "@/components/dashboards/DashboardCard";
import { CreateDashboardDialog } from "@/components/dashboards/CreateDashboardDialog";
import { useDashboardStore } from "@/stores/dashboardStore";
import type { Dashboard } from "@/lib/types";

export default function DashboardsListPage() {
  const dashboards = useDashboardStore((s) => s.dashboards);
  const loaded = useDashboardStore((s) => s.loaded);
  const loading = useDashboardStore((s) => s.loading);
  const remove = useDashboardStore((s) => s.deleteDashboard);
  const duplicate = useDashboardStore((s) => s.duplicateDashboard);
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);

  async function handleDelete(d: Dashboard) {
    if (!confirm(`Удалить дашборд "${d.name}"?`)) return;
    try {
      await remove(d.id);
      toast({ title: "Дашборд удалён" });
    } catch (e) {
      toast({
        title: "Ошибка удаления",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function handleDuplicate(d: Dashboard) {
    try {
      await duplicate(d.id);
      toast({ title: "Дашборд продублирован", variant: "success" });
    } catch (e) {
      toast({
        title: "Ошибка копирования",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  const showSkeleton = !loaded || loading;

  return (
    <PageContainer
      icon={<LayoutDashboard className="h-5 w-5" />}
      title="Дашборды"
      description="Интерактивные отчёты с листами, виджетами и глобальными фильтрами."
      actions={
        <Button variant="gradient" onClick={() => setCreateOpen(true)}>
          <Plus />
          Создать дашборд
        </Button>
      }
    >
      <TabIntro
        beta
        lead="Витрина показателей «с одного взгляда»: KPI, графики и таблицы на одном экране."
        points={[
          { title: "Для чего", text: "Собрать ключевые метрики медиабаинга в один отчёт для руководителя или байера." },
          { title: "Как создать", text: "«Создать дашборд», затем добавляйте листы и виджеты (метрики, графики, сводные) на основе ваших датасетов." },
          { title: "Фильтры", text: "Глобальные фильтры дашборда применяются ко всем виджетам сразу." },
        ]}
      />

      {showSkeleton ? (
        <LoadingState label="Загружаем дашборды…" />
      ) : dashboards.length === 0 ? (
        <EmptyState
          icon={<LayoutDashboard className="h-6 w-6" />}
          title="Нет дашбордов"
          description="Создайте первый дашборд и соберите на нём виджеты из существующих визуализаций."
          action={
            <Button variant="gradient" onClick={() => setCreateOpen(true)}>
              <Plus />
              Создать дашборд
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {dashboards.map((d) => (
            <DashboardCard
              key={d.id}
              dashboard={d}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
            />
          ))}
        </div>
      )}

      <CreateDashboardDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageContainer>
  );
}
