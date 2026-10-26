"use client";

import { BRAND_NAME, BRAND_FILE_PREFIX } from "@/lib/brand";
import { useState } from "react";
import { marked } from "marked";
import { Copy, FileDown, FileText, FileSpreadsheet, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import type { QueryResultRow } from "@/lib/types";

interface Props {
  markdown: string;
  datasetName: string;
  prompt: string;
  /** Срез данных анализа — если передан, доступна выгрузка в Excel (.xlsx). */
  rows?: QueryResultRow[];
  /** Опц. провайдер PNG-снимка графика — если есть, добавляется листом в Excel. */
  chartPngProvider?: () => Promise<string | null>;
}

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sanitize(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

export function ExportPanel({
  markdown,
  datasetName,
  prompt,
  rows,
  chartPngProvider,
}: Props) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toast({
        title: "Не удалось скопировать",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  function onDownloadTxt() {
    const blob = new Blob([markdown], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-analysis-${todayStamp()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function onDownloadExcel() {
    if (!rows || rows.length === 0) return;
    setExcelLoading(true);
    try {
      const { downloadAnalysisXlsx } = await import("@/lib/excel-export");
      const chartPngDataUrl = chartPngProvider
        ? await chartPngProvider()
        : undefined;
      await downloadAnalysisXlsx({
        filename: `${sanitize(datasetName || BRAND_FILE_PREFIX)}-analysis-${todayStamp()}`,
        analysisText: markdown,
        prompt,
        rows,
        chartPngDataUrl,
      });
    } catch (e) {
      toast({
        title: "Не удалось создать Excel",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setExcelLoading(false);
    }
  }

  async function onDownloadPdf() {
    setPdfLoading(true);
    try {
      const { default: html2pdf } = await import("html2pdf.js");
      const html = marked.parse(markdown, { async: false }) as string;
      const now = new Date();
      const dateStr = now.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const container = document.createElement("div");
      container.innerHTML = `
        <div style="font-family: Onest, Arial, sans-serif; color: #111; background: #fff; padding: 32px; line-height: 1.55; font-size: 12pt;">
          <div style="border-bottom: 2px solid #A663B9; padding-bottom: 12px; margin-bottom: 20px;">
            <h1 style="margin: 0; font-size: 20pt; color: #343447; letter-spacing: -0.01em;">${escapeHtml(BRAND_NAME)} — Анализ данных</h1>
            <div style="margin-top: 6px; color: #555; font-size: 10pt;">${escapeHtml(dateStr)}</div>
          </div>
          <div style="margin-bottom: 18px;">
            <div style="font-size: 9pt; text-transform: uppercase; letter-spacing: 0.08em; color: #A663B9; font-weight: 600;">Датасет</div>
            <div style="margin-top: 2px; font-weight: 600;">${escapeHtml(datasetName || "—")}</div>
          </div>
          <div style="margin-bottom: 22px;">
            <div style="font-size: 9pt; text-transform: uppercase; letter-spacing: 0.08em; color: #A663B9; font-weight: 600;">Промпт</div>
            <div style="margin-top: 4px; background: #f5f5f7; border-left: 3px solid #A663B9; padding: 10px 14px; border-radius: 4px; white-space: pre-wrap;">${escapeHtml(prompt || "")}</div>
          </div>
          <div class="ai-analysis-body">${html}</div>
        </div>
        <style>
          .ai-analysis-body h1 { font-size: 16pt; margin-top: 18px; color: #1a1a1a; }
          .ai-analysis-body h2 { font-size: 14pt; margin-top: 16px; color: #1a1a1a; border-bottom: 1px solid #e5e5ea; padding-bottom: 4px; }
          .ai-analysis-body h3 { font-size: 12pt; margin-top: 12px; color: #343447; }
          .ai-analysis-body p { margin: 8px 0; }
          .ai-analysis-body ul, .ai-analysis-body ol { margin: 8px 0; padding-left: 22px; }
          .ai-analysis-body li { margin: 3px 0; }
          .ai-analysis-body strong { color: #111; }
          .ai-analysis-body code { font-family: 'Space Mono', 'Courier New', monospace; background: #f5f5f7; padding: 1px 5px; border-radius: 3px; font-size: 10pt; }
          .ai-analysis-body pre { background: #f5f5f7; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 9.5pt; }
          .ai-analysis-body pre code { background: transparent; padding: 0; }
          .ai-analysis-body table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10pt; }
          .ai-analysis-body th, .ai-analysis-body td { border: 1px solid #d1d1d6; padding: 6px 9px; text-align: left; }
          .ai-analysis-body th { background: #f5f5f7; font-weight: 600; }
          .ai-analysis-body blockquote { border-left: 3px solid #E4A5FD; margin: 10px 0; padding: 4px 14px; color: #444; background: #f9f9fb; }
        </style>
      `;

      await html2pdf()
        .set({
          margin: [10, 10, 12, 10],
          filename: `ai-analysis-${todayStamp()}.pdf`,
          image: { type: "jpeg", quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(container)
        .save();
    } catch (e) {
      toast({
        title: "Не удалось создать PDF",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" onClick={onCopy}>
        {copied ? (
          <>
            <Check className="text-success" />
            Скопировано
          </>
        ) : (
          <>
            <Copy />
            Копировать
          </>
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDownloadPdf}
        disabled={pdfLoading}
      >
        <FileDown />
        {pdfLoading ? "Формируется…" : "Скачать PDF"}
      </Button>
      <Button variant="ghost" size="sm" onClick={onDownloadTxt}>
        <FileText />
        Скачать TXT
      </Button>
      {rows && rows.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onDownloadExcel}
          disabled={excelLoading}
        >
          <FileSpreadsheet />
          {excelLoading ? "Формируется…" : "Скачать Excel"}
        </Button>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
