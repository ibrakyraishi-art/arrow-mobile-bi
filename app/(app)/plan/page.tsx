"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Plus, Target } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { TabIntro } from "@/components/layout/TabIntro";
import { LoadingState } from "@/components/layout/LoadingState";
import { Button } from "@/components/ui/button";
import { usePlanStore } from "@/stores/planStore";
import { useDatasetStore } from "@/stores/datasetStore";
import { DEMO_PLAN_PROJECT_ID, moscowMonth } from "@/lib/plan";
import { PlanProjectCard } from "@/components/plan/PlanProjectCard";
import { PlanProjectDialog } from "@/components/plan/PlanProjectDialog";
import { datasetName, useEnsurePlanLoaded } from "@/components/plan/plan-ui";

export default function PlanListPage() {
  useEnsurePlanLoaded();
  const router = useRouter();
  const projects = usePlanStore((s) => s.projects);
  const loaded = usePlanStore((s) => s.loaded);
  const loading = usePlanStore((s) => s.loading);
  const storeError = usePlanStore((s) => s.error);
  const reload = usePlanStore((s) => s.reload);
  const datasets = useDatasetStore((s) => s.datasets);
  const [createOpen, setCreateOpen] = useState(false);
  const month = useMemo(() => moscowMonth(new Date()), []);

  const datasetsLoaded = useDatasetStore((s) => s.loaded);
  // Датасеты у каждого свои (RLS), а план-проекты общие: проект коллеги на
  // его датасете у вас не посчитается — показываем его отдельно и честно.
  const ownDataset = (p: { datasetId: string }) =>
    !datasetsLoaded || datasets.some((d) => d.id === p.datasetId);
  const allTeam = projects.filter((p) => !p.isDemo);
  const team = allTeam.filter(ownDataset);
  const foreign = allTeam.filter((p) => !ownDataset(p));
  const demo = projects.filter((p) => p.isDemo);

  const createButton = (
    <Button variant="gradient" onClick={() => setCreateOpen(true)}>
      <Plus />
      Создать план-проект
    </Button>
  );

  return (
    <PageContainer
      icon={<Target className="h-5 w-5" />}
      title="План"
      description="План-проекты команды: план на месяц по полям датасета и выполнение темпа с начала месяца."
      actions={createButton}
    >
      <TabIntro
        lead="Вписываете план на месяц — сервис считает темп, прогноз и светофор, а поля плана появляются в конструкторе графиков."
        points={[
          { title: "Проект", text: "Один датасет (обычно один клиент, например «Яндекс» или «Sun») и колонка даты." },
          { title: "Поля", text: "Берёте метрику датасета (расход, установки, CPI, ROAS), задаёте тип и направление." },
          { title: "План", text: "Сетка «поле × месяц» как в Excel: вписали цифру — сохранилось." },
          { title: "Дашборд", text: "Кнопка «Собрать дашборд план/факт» строит готовый отчёт по вашим полям." },
          { title: "Доступ", text: "План-проекты общие: все вошедшие видят и правят их. Но датасеты у каждого свои — факт по проекту считается у того, чей это датасет." },
        ]}
      />

      {storeError && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warn/40 bg-warn/10 px-4 py-2 text-sm text-foreground">
          <span>План-проекты команды не загрузились: {storeError}. Демо доступно.</span>
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
            Повторить
          </Button>
        </div>
      )}

      {!loaded || loading ? (
        <LoadingState label="Загружаем план-проекты…" />
      ) : (
        <div className="space-y-6">
          {team.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-card/30 p-8">
              <div className="mx-auto max-w-2xl space-y-3 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md tile-gradient">
                  <Target className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold">Планов пока нет</h3>
                <p className="text-sm text-muted-foreground">
                  План-проект отвечает на вопрос «выполняем ли мы план»: бюджет идёт на 88% от
                  темпа, а установки — на 100%? Вы задаёте план на месяц по полям датасета, а
                  сервис каждый день показывает выполнение, прогноз на конец месяца и светофор.
                </p>
                <div className="flex flex-wrap justify-center gap-2 pt-1">
                  {createButton}
                  <Button variant="outline" asChild>
                    <Link href={`/plan/${DEMO_PLAN_PROJECT_ID}`}>
                      <Eye />
                      Посмотреть демо
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">Проекты команды</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {team.map((p) => (
                  <PlanProjectCard
                    key={p.id}
                    project={p}
                    datasetName={datasetName(datasets, p.datasetId)}
                    month={month}
                  />
                ))}
              </div>
            </section>
          )}

          {foreign.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">
                Проекты коллег на их датасетах
              </h2>
              <p className="text-xs text-muted-foreground">
                Датасеты видит только их владелец, поэтому факт по этим проектам у вас не
                посчитается. Чтобы вести такой план самому — загрузите данные клиента в свой
                источник и создайте проект на своём датасете.
              </p>
              <ul className="divide-y divide-border rounded-md border border-border bg-card/30 text-sm">
                {foreign.map((p) => (
                  <li key={p.id} className="px-4 py-2">
                    {p.name}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {demo.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">Демо</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {demo.map((p) => (
                  <PlanProjectCard
                    key={p.id}
                    project={p}
                    datasetName={datasetName(datasets, p.datasetId)}
                    month={month}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <PlanProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(p) => router.push(`/plan/${p.id}`)}
      />
    </PageContainer>
  );
}
