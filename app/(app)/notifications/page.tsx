"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { TabIntro } from "@/components/layout/TabIntro";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { InlineHelp } from "@/components/help/InlineHelp";
import { ConnectionsTab } from "@/components/notifications/ConnectionsTab";
import { TemplatesTab } from "@/components/notifications/TemplatesTab";
import { RulesTab } from "@/components/notifications/RulesTab";
import { RunsTab } from "@/components/notifications/RunsTab";

const TABS = [
  { id: "connections", label: "Подключения" },
  { id: "templates", label: "Шаблоны сообщений" },
  { id: "rules", label: "Правила" },
  { id: "runs", label: "История" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function NotificationsPage() {
  const [tab, setTab] = useState<TabId>("connections");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const hash =
      typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (TABS.some((t) => t.id === hash)) {
      setTab(hash as TabId);
    }
  }, []);

  function onTabChange(v: string) {
    if (TABS.some((t) => t.id === v)) {
      setTab(v as TabId);
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `#${v}`);
      }
    }
  }

  return (
    <PageContainer
      icon={<Bell className="h-5 w-5" />}
      title="Алерты Telegram"
      description="Telegram-боты, шаблоны сообщений, правила алертов и история срабатываний."
    >
      <TabIntro
        beta
        lead="Telegram-алерты по правилам: боты, шаблоны, правила и история."
        points={[
          { title: "Для чего", text: "Автоматически уведомлять в Telegram, когда метрики выходят за заданные пороги." },
          { title: "Подключения", text: "Добавьте Telegram-бота и чат — токен хранится зашифрованным и не покидает сервер." },
          { title: "Правила", text: "Задайте метрику, условие/порог и расписание; срабатывания видны во вкладке «История»." },
        ]}
      />

      <Tabs value={tab} onValueChange={onTabChange} className="w-full">
        <TabsList className="mb-4">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="mb-4">
          <InlineHelp title="Как это работает: алерты по шагам">
            <p>
              <b className="text-foreground">1. Подключения</b> — добавьте
              Telegram-бота и чат, куда слать (токен хранится зашифрованным и не
              покидает сервер).
            </p>
            <p>
              <b className="text-foreground">2. Шаблоны сообщений</b> — текст
              уведомления (можно с переменными метрик).
            </p>
            <p>
              <b className="text-foreground">3. Правила</b> — метрика + условие/порог
              + расписание (например, «ROAS меньше 100% — проверять раз в день»).
            </p>
            <p>
              <b className="text-foreground">4. История</b> — что и когда сработало.
            </p>
          </InlineHelp>
        </div>
        <TabsContent value="connections">
          <ConnectionsTab refreshKey={refreshKey} />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesTab refreshKey={refreshKey} />
        </TabsContent>
        <TabsContent value="rules">
          <RulesTab
            onCreated={() => setRefreshKey((k) => k + 1)}
            refreshKey={refreshKey}
          />
        </TabsContent>
        <TabsContent value="runs">
          <RunsTab refreshKey={refreshKey} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
