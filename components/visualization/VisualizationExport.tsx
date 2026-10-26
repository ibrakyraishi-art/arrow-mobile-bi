"use client";

import { exportBackgroundColor } from "@/lib/theme";
import { useState, type RefObject } from "react";
import { Download, FileSpreadsheet, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import type { QueryResultRow, VisualizationType } from "@/lib/types";

interface Props {
  name: string;
  type: VisualizationType;
  data: QueryResultRow[];
  chartRef: RefObject<HTMLDivElement>;
}

function sanitizeFilename(name: string): string {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "_")
      .slice(0, 80) || "visualization"
  );
}

function toCsv(rows: QueryResultRow[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n;\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = keys.join(",");
  const body = rows.map((r) => keys.map((k) => esc(r[k])).join(",")).join("\n");
  return `${header}\n${body}`;
}

export function VisualizationExport({ name, type, data, chartRef }: Props) {
  const { toast } = useToast();
  const [pngLoading, setPngLoading] = useState(false);
  const isChart = type !== "pivot";
  const filename = sanitizeFilename(name || "visualization");
  const canExportCsv = data.length > 0;
  const canExportPng = isChart && data.length > 0;

  function onDownloadCsv() {
    if (!canExportCsv) return;
    const csv = toCsv(data);
    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function onDownloadPng() {
    if (!canExportPng) return;
    const node = chartRef.current;
    if (!node) {
      toast({
        title: "График не найден",
        variant: "destructive",
      });
      return;
    }
    setPngLoading(true);
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: exportBackgroundColor(node),
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${filename}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      toast({
        title: "Не удалось сохранить PNG",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setPngLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onDownloadCsv}
        disabled={!canExportCsv}
        title="Экспорт данных в CSV (UTF-8 + BOM)"
      >
        <FileSpreadsheet />
        CSV
      </Button>
      {isChart && (
        <Button
          variant="outline"
          size="sm"
          onClick={onDownloadPng}
          disabled={!canExportPng || pngLoading}
          title="Сохранить график как PNG"
        >
          {pngLoading ? <Download className="animate-pulse" /> : <ImageIcon />}
          PNG
        </Button>
      )}
    </div>
  );
}
