"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Save,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useDataSourceStore } from "@/stores/dataSourceStore";
import { useDatasetStore } from "@/stores/datasetStore";
import {
  parseCsvBuffer,
  parseCsvText,
  parseExcelArrayBuffer,
  type ParsedFile,
} from "@/lib/file-parse";
import {
  FILE_MAX_ROWS,
  FILE_MAX_SIZE_BYTES,
  FILE_MAX_SIZE_MB,
} from "@/lib/file-constants";

type FileFormat = "csv" | "excel" | "gsheet";

const TYPE_LABEL: Record<string, string> = {
  integer: "число",
  float: "число",
  string: "текст",
  category: "категория",
  date: "дата",
  datetime: "дата-время",
  boolean: "да/нет",
};

export function FileSourceForm({ format }: { format: FileFormat }) {
  const router = useRouter();
  const { toast } = useToast();
  const createFileSource = useDataSourceStore((s) => s.createFileSource);
  const isSheet = format === "gsheet";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  // Вкладки книги Google Sheets (если их несколько — пользователь выбирает лист).
  const [tabs, setTabs] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState<string | undefined>(undefined);
  // Зашифрованная НА СЕРВЕРЕ ссылка на таблицу — храним её вместо открытой
  // (ссылка = доступ к данным, поэтому это конфиденциально).
  const [sheetUrlEnc, setSheetUrlEnc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    if (file.size > FILE_MAX_SIZE_BYTES) {
      setError(
        `Файл слишком большой (${(file.size / 1024 / 1024).toFixed(1)} МБ). ` +
          `Максимум — ${FILE_MAX_SIZE_MB} МБ.`,
      );
      return;
    }
    setBusy(true);
    setParsed(null);
    try {
      let result: ParsedFile;
      if (format === "excel") {
        result = await parseExcelArrayBuffer(await file.arrayBuffer());
      } else {
        // Читаем как байты, чтобы определить кодировку (UTF-8/Windows-1251) и снять BOM.
        result = await parseCsvBuffer(await file.arrayBuffer());
      }
      setParsed(result);
      if (!name.trim()) {
        setName(file.name.replace(/\.(csv|tsv|txt|xlsx|xls)$/i, ""));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  interface SheetPreviewResp {
    tabs: string[];
    sheetName: string;
    columns: ParsedFile["columns"];
    rows: ParsedFile["rows"];
    truncated: boolean;
    /** Ссылка на таблицу, зашифрованная сервером — её и сохраняем. */
    sheetUrlEnc?: string;
    error?: string;
  }

  async function loadSheet() {
    if (!url.trim()) return;
    setError(null);
    setBusy(true);
    setParsed(null);
    setTabs([]);
    setSheetName(undefined);
    setSheetUrlEnc(null);
    try {
      // Основной путь: xlsx — получаем список вкладок + разбор первой.
      const res = await fetch("/api/data-sources/sheet-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (res.ok) {
        const j = (await res.json()) as SheetPreviewResp;
        setTabs(j.tabs ?? []);
        setSheetName(j.sheetName);
        setSheetUrlEnc(j.sheetUrlEnc ?? null);
        setParsed({ columns: j.columns, rows: j.rows, truncated: j.truncated });
        if (!name.trim()) setName("Google Sheet");
        return;
      }
      // xlsx недоступен — откат на CSV первого листа (вкладки не покажем).
      const res2 = await fetch("/api/data-sources/fetch-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const j2 = (await res2.json()) as {
        csv?: string;
        sheetUrlEnc?: string;
        error?: string;
      };
      if (!res2.ok || !j2.csv) throw new Error(j2.error ?? `HTTP ${res2.status}`);
      setSheetUrlEnc(j2.sheetUrlEnc ?? null);
      const result = await parseCsvText(j2.csv);
      setParsed(result);
      if (!name.trim()) setName("Google Sheet");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function selectTab(tab: string) {
    if (!url.trim()) return;
    setSheetName(tab);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/data-sources/sheet-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), sheetName: tab }),
      });
      const j = (await res.json()) as SheetPreviewResp;
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      if (j.sheetUrlEnc) setSheetUrlEnc(j.sheetUrlEnc);
      setParsed({ columns: j.columns, rows: j.rows, truncated: j.truncated });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!parsed || !name.trim()) return;
    setSaving(true);
    try {
      // Google Sheets — всегда «живой» режим: данные не храним, тянем по ссылке.
      // В source_meta кладём ЗАШИФРОВАННУЮ ссылку (sheetUrlEnc); открытую (sheetUrl)
      // — только если шифрование почему-то не получили (фолбэк совместимости).
      const sheetMeta = isSheet
        ? {
            ...(sheetUrlEnc
              ? { sheetUrlEnc }
              : { sheetUrl: url.trim() }),
            ...(sheetName ? { sheetName } : {}),
          }
        : {};
      const { datasetId } = await createFileSource({
        name: name.trim(),
        description: description.trim() || undefined,
        format,
        columns: parsed.columns,
        rows: parsed.rows,
        sourceMeta: sheetMeta,
        mode: isSheet ? "live" : "snapshot",
      });
      const uid = useDataSourceStore.getState().currentUserId;
      if (uid) await useDatasetStore.getState().loadFromSupabase(uid);
      toast({
        title: "Источник создан",
        description: isSheet
          ? "Живой режим · данные тянутся по ссылке"
          : `${parsed.rows.length.toLocaleString("ru-RU")} строк · датасет готов`,
        variant: "success",
      });
      router.push(`/datasets/${datasetId}`);
    } catch (e) {
      toast({
        title: "Не удалось сохранить",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const accept = format === "excel" ? ".xlsx,.xls" : ".csv,.tsv,.txt";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="surface p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-semibold">
            {format === "gsheet"
              ? "Google Sheets"
              : format === "excel"
                ? "Файл Excel (.xlsx)"
                : "Файл CSV"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {format === "gsheet"
              ? "Вставьте ссылку на таблицу. Лист должен быть открыт по ссылке (Просмотр) или опубликован."
              : `Загрузите файл. Первая строка — заголовки. До ${FILE_MAX_ROWS.toLocaleString("ru-RU")} строк.`}
          </p>

          {format === "gsheet" && (
            <details className="rounded-lg border border-border/60 bg-background/40 p-2.5 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">
                Как подготовить таблицу (важно для корректного анализа)
              </summary>
              <ul className="mt-2 ml-4 list-disc space-y-1">
                <li>
                  Первая строка — <span className="font-medium text-foreground">заголовки</span>{" "}
                  столбцов (короткие, без формул и объединённых ячеек).
                </li>
                <li>Одна ячейка — одно значение. Один лист — одна таблица.</li>
                <li>
                  <span className="font-medium text-foreground">Числа — числами</span>, без
                  текста и символов валют: пишите{" "}
                  <code className="font-mono">1234,56</code> (или{" "}
                  <code className="font-mono">1234.56</code>), а не{" "}
                  <code className="font-mono">«1 234,56 ₽»</code>. Десятичный
                  разделитель — запятая или точка, но единообразно в пределах
                  столбца.
                </li>
                <li>Без строк «Итого» и пустых строк-разделителей внутри данных.</li>
                <li>
                  Даты — распознаём распространённые форматы:{" "}
                  <code className="font-mono">ДД.ММ.ГГГГ</code>,{" "}
                  <code className="font-mono">ДД/ММ/ГГГГ</code>,{" "}
                  <code className="font-mono">ГГГГ-ММ-ДД</code> и др.; в пределах
                  столбца лучше один формат.
                </li>
                <li>
                  Доступ: «Настройки доступа» → «Все, у кого есть ссылка» (Просмотр).
                </li>
              </ul>
            </details>
          )}
        </div>

        {/* Название и описание — всегда видны, чтобы пользователь сразу задал
            понятное имя источнику (а не дефолтное «Google Sheet»). */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fs-name">
              Название источника <span className="text-destructive">*</span>
            </Label>
            <Input
              id="fs-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Отчёт за июнь"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fs-desc">
              Описание{" "}
              <span className="text-xs font-normal text-muted-foreground">
                — необязательно
              </span>
            </Label>
            <Input
              id="fs-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Что внутри: период, кампании, источник выгрузки"
            />
          </div>
        </div>

        {/* Источник данных */}
        {format === "gsheet" ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                className="flex-1"
              />
              <Button variant="outline" onClick={loadSheet} disabled={busy || !url.trim()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Загрузить
              </Button>
            </div>

            {/* Выбор листа (вкладки), если их несколько */}
            {tabs.length > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor="fs-tab">Лист (вкладка)</Label>
                <select
                  id="fs-tab"
                  value={sheetName ?? ""}
                  onChange={(e) => void selectTab(e.target.value)}
                  disabled={busy}
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground"
                >
                  {tabs.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  В таблице несколько листов — выберите нужный.
                </p>
              </div>
            )}

            {/* Живой режим — единственный для Google Sheets: данные не храним */}
            <div className="rounded-xl border border-primary/30 bg-primary/[0.05] p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" /> Живой режим (данные
                не храним у себя)
              </div>
              <ul className="mt-1.5 ml-4 list-disc space-y-1 text-xs text-muted-foreground">
                <li>
                  Данные{" "}
                  <span className="font-medium text-foreground">не сохраняются у нас</span>{" "}
                  — подтягиваются из таблицы по ссылке при каждом запросе (всегда
                  свежие, без лимита строк).
                </li>
                <li>
                  Сама ссылка на таблицу{" "}
                  <span className="font-medium text-foreground">шифруется на сервере</span>{" "}
                  (как пароль): в базе нет открытой ссылки, прочитать её без
                  серверного ключа нельзя.
                </li>
                <li>
                  При удалении источника не остаётся ничего — хранить нечего.
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-hair-2 bg-muted/30 px-4 py-8 text-center transition-colors hover:border-primary"
            >
              {busy ? (
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              ) : (
                <Upload className="h-6 w-6 text-muted-foreground" />
              )}
              <span className="text-sm text-foreground">
                {busy ? "Читаем файл…" : "Нажмите, чтобы выбрать файл"}
              </span>
              <span className="text-xs text-faint">{accept}</span>
            </button>
          </div>
        )}

        {error && (
          <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Предпросмотр */}
      {parsed && (
        <div className="surface overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="font-medium text-foreground">
                {parsed.columns.length} столбцов ·{" "}
                {parsed.rows.length.toLocaleString("ru-RU")} строк
              </span>
            </div>
            <span className="text-xs text-faint">первые 10 строк</span>
          </div>

          {parsed.truncated && !isSheet && (
            <div className="flex gap-2 border-b border-border bg-warning/[0.08] px-4 py-2.5 text-[12px] text-muted-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
              Обрезано до {FILE_MAX_ROWS.toLocaleString("ru-RU")} строк. Для больших
              объёмов используйте Google Sheets (живой режим) или ClickHouse.
            </div>
          )}
          {isSheet && (
            <div className="flex gap-2 border-b border-border bg-primary/[0.06] px-4 py-2.5 text-[12px] text-muted-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0 text-primary" />
              Живой режим: при запросах тянется вся таблица по ссылке (без лимита
              строк). Ниже — предпросмотр первых строк.
            </div>
          )}

          <div className="max-h-72 overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-popover">
                <tr>
                  {parsed.columns.map((c) => (
                    <th
                      key={c.name}
                      className="border-b border-border px-3 py-2 text-left font-mono font-medium text-foreground"
                    >
                      <div className="whitespace-nowrap">{c.name}</div>
                      <div className="text-[10px] font-normal uppercase tracking-wider text-faint">
                        {TYPE_LABEL[c.type] ?? c.type}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 10).map((row, i) => (
                  <tr key={i} className="even:bg-muted/20">
                    {parsed.columns.map((c) => (
                      <td
                        key={c.name}
                        className="whitespace-nowrap border-b border-border/60 px-3 py-1.5 font-mono text-muted-foreground"
                      >
                        {row[c.name] === null || row[c.name] === undefined
                          ? "—"
                          : String(row[c.name])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end border-t border-border p-3">
            <Button
              variant="gradient"
              onClick={save}
              disabled={saving || !name.trim() || parsed.rows.length === 0}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Сохранить источник
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
