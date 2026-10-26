"use client";

import { useState } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { ConnectionForm } from "@/components/data-sources/ConnectionForm";
import { FileSourceForm } from "@/components/data-sources/FileSourceForm";
import { SecurityNote } from "@/components/data-sources/SecurityNote";
import { DemoCsvLink } from "@/components/plan/DemoLinks";
import { cn } from "@/lib/utils";
import { Database, FileSpreadsheet, Sheet } from "lucide-react";

type SourceType = "clickhouse" | "file" | "gsheet";
type FileKind = "csv" | "excel";

const TYPES: {
  id: SourceType;
  label: string;
  hint: string;
  icon: typeof Database;
}[] = [
  { id: "clickhouse", label: "ClickHouse", hint: "Подключение к серверу", icon: Database },
  // Загрузка файлом (D02): тот же FileSourceForm, что до #126; данные хранятся
  // снимком в file_sources (лимит FILE_MAX_ROWS строк, FILE_MAX_SIZE_MB).
  { id: "file", label: "Файл (CSV / Excel)", hint: "Загрузить .csv или .xlsx", icon: FileSpreadsheet },
  { id: "gsheet", label: "Google Sheets", hint: "По ссылке", icon: Sheet },
];

const FILE_KINDS: { id: FileKind; label: string }[] = [
  { id: "csv", label: "CSV" },
  { id: "excel", label: "Excel (.xlsx)" },
];

export default function NewDataSourcePage() {
  const [type, setType] = useState<SourceType>("clickhouse");
  const [fileKind, setFileKind] = useState<FileKind>("csv");

  return (
    <PageContainer
      icon={<Database className="h-5 w-5" />}
      title="Новый источник данных"
      description="Подключите ClickHouse, загрузите файл CSV / Excel или дайте ссылку на Google Sheets."
    >
      {/* Пример данных для тренировки — виден сразу, на любом типе. */}
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
        <div className="text-sm">
          <div className="font-medium text-foreground">Нет своих данных под рукой?</div>
          <div className="text-xs text-muted-foreground">
            Скачайте демо-набор (установки по дням: клиенты, каналы, гео, ₽ и $) и загрузите его
            ниже как «Файл (CSV / Excel)» → CSV.
          </div>
        </div>
        <DemoCsvLink />
      </div>

      {/* Выбор типа источника */}
      <div className="mx-auto mb-5 grid max-w-3xl grid-cols-1 gap-2 sm:grid-cols-3">
        {TYPES.map((t) => {
          const Icon = t.icon;
          const active = type === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setType(t.id)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors",
                active
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-hair-2",
              )}
            >
              <Icon className={cn("h-5 w-5", active ? "text-primary" : "text-muted-foreground")} />
              <span className="text-sm font-medium text-foreground">{t.label}</span>
              <span className="text-[11px] text-faint">{t.hint}</span>
            </button>
          );
        })}
      </div>

      {type === "clickhouse" ? (
        <>
          <div className="mx-auto max-w-3xl">
            <SecurityNote />
          </div>
          <ConnectionForm />
        </>
      ) : type === "file" ? (
        <>
          <div className="mx-auto mb-4 flex max-w-3xl gap-1 rounded-md border border-border bg-card p-1">
            {FILE_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setFileKind(k.id)}
                aria-pressed={fileKind === k.id}
                className={cn(
                  "flex-1 rounded px-3 py-1.5 text-sm transition-colors",
                  fileKind === k.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
          {/* key — свежая форма при смене формата (у формы своё состояние). */}
          <FileSourceForm key={fileKind} format={fileKind} />
        </>
      ) : (
        <FileSourceForm key="gsheet" format="gsheet" />
      )}
    </PageContainer>
  );
}
