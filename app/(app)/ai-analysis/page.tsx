"use client";

import { useState } from "react";
import { Sparkles, Plus } from "lucide-react";
import { PageContainer, EmptyState } from "@/components/layout/PageContainer";
import { TabIntro } from "@/components/layout/TabIntro";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/layout/LoadingState";
import { useToast } from "@/components/ui/use-toast";
import { useAiProjectStore } from "@/stores/aiProjectStore";
import { AiProjectCard } from "@/components/ai/AiProjectCard";
import { CreateAiProjectDialog } from "@/components/ai/CreateAiProjectDialog";
import type { AIProject } from "@/lib/types";

export default function AIAnalysisListPage() {
  const projects = useAiProjectStore((s) => s.projects);
  const loaded = useAiProjectStore((s) => s.loaded);
  const loading = useAiProjectStore((s) => s.loading);
  const remove = useAiProjectStore((s) => s.deleteProject);
  const duplicate = useAiProjectStore((s) => s.duplicateProject);
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);

  async function handleDelete(p: AIProject) {
    if (!confirm(`Удалить проект "${p.name}"? Запуски также будут удалены.`))
      return;
    try {
      await remove(p.id);
      toast({ title: "Проект удалён" });
    } catch (e) {
      toast({
        title: "Ошибка удаления",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function handleDuplicate(p: AIProject) {
    try {
      await duplicate(p.id);
      toast({ title: "Проект продублирован", variant: "success" });
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
      icon={<Sparkles className="h-5 w-5" />}
      title="AI-анализ"
      description="Создавайте проекты для анализа данных. Фильтры, модель и история запусков — всё внутри проекта."
      actions={
        <Button variant="gradient" onClick={() => setCreateOpen(true)}>
          <Plus />
          Создать проект
        </Button>
      }
    >
      <TabIntro
        lead="Анализ данных через Claude с контролем того, что отправляется."
        points={[
          { title: "Для чего", text: "Задавайте вопросы по данным простым языком — AI вернёт разбор с цифрами и рекомендациями." },
          { title: "Проект", text: "Каждый проект привязан к датасету и хранит контекст (поля, маскировку, фильтры) и историю запросов." },
          { title: "Конфиденциальность", text: "Можно замаскировать поля с реальными названиями: в Claude уйдут коды, в ответе вернутся настоящие имена." },
        ]}
      />

      {showSkeleton ? (
        <LoadingState label="Загружаем проекты анализа…" />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-6 w-6" />}
          title="Нет проектов"
          description="Создайте первый проект AI-анализа. Выберите датасет, настройте фильтры и запускайте анализ по сохранённому промпту столько раз, сколько нужно."
          action={
            <Button variant="gradient" onClick={() => setCreateOpen(true)}>
              <Plus />
              Создать проект
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <AiProjectCard
              key={p.id}
              project={p}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
            />
          ))}
        </div>
      )}

      <CreateAiProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageContainer>
  );
}
