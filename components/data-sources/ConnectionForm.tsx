"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { InlineStatus } from "./StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DataSource } from "@/lib/types";
import { useDataSourceStore } from "@/stores/dataSourceStore";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/auth-context";
import { logAudit } from "@/lib/audit";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { CheckCircle2, Loader2, Save } from "lucide-react";

interface FormState {
  name: string;
  description: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

const initial: FormState = {
  name: "",
  description: "",
  host: "",
  port: 8443,
  database: "",
  user: "",
  password: "",
  ssl: true,
};

export function ConnectionForm() {
  const [state, setState] = useState<FormState>(initial);
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testMessage, setTestMessage] = useState<string | undefined>();
  const addDataSource = useDataSourceStore((s) => s.addDataSource);
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setState((prev) => ({ ...prev, [k]: v }));
    setTestStatus("idle");
  };

  const validation = {
    name: state.name.trim().length > 0,
    host: state.host.trim().length > 0,
    port: state.port >= 1 && state.port <= 65535,
    database: state.database.trim().length > 0,
    user: state.user.trim().length > 0,
  };
  const isValid = Object.values(validation).every(Boolean);

  async function onTest() {
    if (!isValid) {
      toast({
        title: "Заполните все обязательные поля",
        variant: "destructive",
      });
      return;
    }
    setTestStatus("testing");
    setTestMessage(undefined);
    try {
      const res = await fetch("/api/data-sources/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: state.host,
          port: state.port,
          database: state.database,
          user: state.user,
          password: state.password,
          ssl: state.ssl,
        }),
      });
      const body = (await res.json()) as {
        success: boolean;
        error?: string;
      };
      if (body.success) {
        setTestStatus("success");
      } else {
        setTestStatus("error");
        setTestMessage(body.error);
      }
    } catch (e) {
      setTestStatus("error");
      setTestMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function onSave() {
    if (testStatus !== "success") return;
    setSaving(true);
    try {
      // Шифруем пароль на сервере (ENCRYPTION_KEY доступен только серверу).
      const encRes = await fetch("/api/data-sources/encrypt-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: state.password }),
      });
      const encJson = (await encRes.json()) as {
        encrypted?: string;
        error?: string;
      };
      if (!encRes.ok || typeof encJson.encrypted !== "string") {
        throw new Error(encJson.error ?? "Не удалось зашифровать пароль");
      }
      const source: Omit<DataSource, "id"> = {
        name: state.name.trim(),
        description: state.description.trim() || undefined,
        host: state.host.trim(),
        port: state.port,
        database: state.database.trim(),
        user: state.user.trim(),
        password: encJson.encrypted,
        ssl: state.ssl,
        status: "connected",
        createdAt: new Date().toISOString(),
        tables: [],
      };
      const created = await addDataSource(source);
      if (user) {
        void logAudit(
          getSupabaseBrowserClient(),
          user.id,
          "data_source_created",
          "data_source",
          created.id,
          { name: created.name },
        );
      }
      toast({
        title: "Источник сохранён",
        description: created.name,
        variant: "success",
      });
      router.push("/data-sources");
    } catch (e) {
      toast({
        title: "Ошибка сохранения",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-3xl mx-auto shiny-border">
      <CardHeader>
        <CardTitle className="text-lg">Новое подключение</CardTitle>
        <p className="text-sm text-muted-foreground">
          Введите параметры ClickHouse. Пароль шифруется на сервере и хранится
          только в зашифрованном виде — в коде ничего не хардкодится.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="name">Название подключения</Label>
          <Input
            id="name"
            placeholder="Production DB"
            value={state.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">
            Описание{" "}
            <span className="text-xs font-normal text-muted-foreground">
              — необязательно
            </span>
          </Label>
          <Input
            id="description"
            placeholder="Для чего этот источник: проект, клиент, среда"
            value={state.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-3 space-y-2">
            <Label htmlFor="host">Хост</Label>
            <Input
              id="host"
              placeholder="clickhouse.mycompany.com"
              value={state.host}
              onChange={(e) => set("host", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="port">Порт</Label>
            <Input
              id="port"
              type="number"
              min={1}
              max={65535}
              value={state.port}
              onChange={(e) => set("port", Number(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="database">База данных</Label>
          <Input
            id="database"
            placeholder="analytics"
            value={state.database}
            onChange={(e) => set("database", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="user">Пользователь</Label>
            <Input
              id="user"
              placeholder="reader"
              value={state.user}
              onChange={(e) => set("user", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Пароль</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={state.password}
              onChange={(e) => set("password", e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 p-3">
          <div>
            <Label htmlFor="ssl" className="cursor-pointer">
              SSL (HTTPS)
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Рекомендуется для боевых серверов
            </p>
          </div>
          <Switch
            id="ssl"
            checked={state.ssl}
            onCheckedChange={(v) => set("ssl", v)}
          />
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <InlineStatus status={testStatus} message={testMessage} />
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="outline"
              onClick={onTest}
              disabled={!isValid || testStatus === "testing"}
            >
              <CheckCircle2 />
              Проверить
            </Button>
            <Button
              variant="gradient"
              onClick={onSave}
              disabled={testStatus !== "success" || saving}
            >
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              Сохранить
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
