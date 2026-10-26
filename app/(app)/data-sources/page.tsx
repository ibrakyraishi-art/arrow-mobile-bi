"use client";

import { useState } from "react";
import Link from "next/link";
import { PageContainer, EmptyState } from "@/components/layout/PageContainer";
import { TabIntro } from "@/components/layout/TabIntro";
import { Button } from "@/components/ui/button";
import { useDataSourceStore } from "@/stores/dataSourceStore";
import { useDatasetStore } from "@/stores/datasetStore";
import { useVisualizationStore } from "@/stores/visualizationStore";
import { useDashboardStore } from "@/stores/dashboardStore";
import { ConnectionCard } from "@/components/data-sources/ConnectionCard";
import { EditSourceDialog } from "@/components/data-sources/EditSourceDialog";
import { SecurityNote } from "@/components/data-sources/SecurityNote";
import { GetStartedBanner } from "@/components/onboarding/GetStartedBanner";
import { Database, Plus } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import type { DataSource } from "@/lib/types";
import { LoadingState } from "@/components/layout/LoadingState";
import { useAuth } from "@/lib/auth-context";
import { logAudit } from "@/lib/audit";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function DataSourcesPage() {
  const sources = useDataSourceStore((s) => s.sources);
  const loaded = useDataSourceStore((s) => s.loaded);
  const loading = useDataSourceStore((s) => s.loading);
  const removeDataSource = useDataSourceStore((s) => s.removeDataSource);
  const updateDataSource = useDataSourceStore((s) => s.updateDataSource);
  const reloadSources = useDataSourceStore((s) => s.loadFromSupabase);
  // После удаления источника БД каскадом сносит его датасеты/визуализации/алерты/
  // виджеты — перезагружаем зависимые сторы, чтобы из UI пропали удалённые объекты.
  const reloadDatasets = useDatasetStore((s) => s.loadFromSupabase);
  const reloadVisualizations = useVisualizationStore((s) => s.loadFromSupabase);
  const reloadDashboards = useDashboardStore((s) => s.loadFromSupabase);
  const { toast } = useToast();
  const { user } = useAuth();
  const [editingSource, setEditingSource] = useState<DataSource | null>(null);

  function handleEdit(s: DataSource) {
    if (s.isDemo) {
      toast({
        title: "Нельзя изменить демо-источник",
        description: "Он нужен для быстрого знакомства с платформой.",
      });
      return;
    }
    setEditingSource(s);
  }

  async function handleDelete(s: DataSource) {
    if (s.isDemo) {
      toast({
        title: "Нельзя удалить демо-источник",
        description: "Он нужен для быстрого знакомства с платформой.",
      });
      return;
    }
    if (
      !confirm(
        `Удалить источник "${s.name}"?\n\nБезвозвратно удалятся также все его ` +
          `датасеты, визуализации и алерт-правила (вместе с историей), ` +
          `построенные на нём. Действие необратимо.`,
      )
    )
      return;
    try {
      await removeDataSource(s.id);
      if (user) {
        void logAudit(
          getSupabaseBrowserClient(),
          user.id,
          "data_source_deleted",
          "data_source",
          s.id,
          { name: s.name },
        );
        // Синхронизируем зависимые сторы с каскадом БД (иначе покажут стейл).
        void reloadDatasets(user.id);
        void reloadVisualizations(user.id);
        void reloadDashboards(user.id);
      }
      toast({ title: "Источник удалён", variant: "default" });
    } catch (e) {
      toast({
        title: "Ошибка удаления",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function handleRefresh(s: DataSource) {
    // Файловый источник (Google Sheets): перечитываем таблицу по ссылке.
    if (s.kind === "file") {
      try {
        const res = await fetch(`/api/data-sources/${s.id}/refresh-sheet`, {
          method: "POST",
        });
        const j = (await res.json()) as { rowCount?: number; error?: string };
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        // Данные изменились — обновляем датасеты (превью) и источники (отметка
        // «обновлено» на карточке), чтобы не было стейл.
        if (user) {
          void reloadDatasets(user.id);
          void reloadSources(user.id);
        }
        toast({
          title: "Данные обновлены",
          description: `${(j.rowCount ?? 0).toLocaleString("ru-RU")} строк из таблицы`,
          variant: "success",
        });
      } catch (e) {
        toast({
          title: "Не удалось обновить данные",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      }
      return;
    }
    try {
      await updateDataSource(s.id, { status: "connected" });
      toast({ title: "Статус обновлён", variant: "success" });
    } catch (e) {
      toast({
        title: "Ошибка обновления",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  const showSkeleton = !loaded || loading;

  return (
    <PageContainer
      icon={<Database className="h-5 w-5" />}
      title="Источники данных"
      description="Подключите свои ClickHouse-инстансы и управляйте ими в одном месте."
      actions={
        <Button asChild variant="gradient">
          <Link href="/data-sources/new">
            <Plus />
            Добавить источник
          </Link>
        </Button>
      }
    >
      <GetStartedBanner />
      <TabIntro
        lead="Подключения к данным — основа для датасетов, визуализаций и анализа."
        points={[
          { title: "Для чего", text: "Источник — это откуда берутся данные: ClickHouse, Google Sheets (по ссылке) или Файл (CSV / Excel)." },
          { title: "Как добавить", text: "«Добавить источник» → ClickHouse (параметры подключения), Файл (CSV / Excel: загрузка с предпросмотром, хранится снимком до 5000 строк) или Google Sheets (если в таблице несколько листов — выберите нужный). Google-таблицы работают в живом режиме: данные не храним — тянем по ссылке при каждом запросе (ссылка шифруется на сервере)." },
          { title: "Безопасность", text: "Пароли шифруются на сервере; при удалении источника данные удаляются полностью — подробнее в блоке ниже." },
        ]}
      />

      <SecurityNote />
      {showSkeleton ? (
        <LoadingState label="Загружаем источники данных…" />
      ) : sources.length === 0 ? (
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Нет подключённых источников"
          description="Подключите ClickHouse, чтобы создавать датасеты, строить сводные таблицы и запускать AI-анализ."
          action={
            <Button asChild variant="gradient">
              <Link href="/data-sources/new">
                <Plus />
                Добавить источник
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sources.map((s) => (
            <ConnectionCard
              key={s.id}
              source={s}
              onRefresh={handleRefresh}
              onDelete={handleDelete}
              onEdit={handleEdit}
            />
          ))}
        </div>
      )}

      <EditSourceDialog
        source={editingSource}
        onOpenChange={(open) => {
          if (!open) setEditingSource(null);
        }}
      />
    </PageContainer>
  );
}
