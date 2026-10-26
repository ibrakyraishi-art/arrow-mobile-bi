import { DEMO_CSV_FILENAME, demoRowsToCsv, generateDemoRows } from "@/lib/demo-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Пример CSV для загрузки «как свой источник» — на сегодняшний день по Москве,
 * тем же генератором, что и встроенное демо. Статичный файл в public/demo
 * через месяц перестал бы покрывать текущий месяц, и план по нему был бы без факта.
 */
export function GET() {
  return new Response(demoRowsToCsv(generateDemoRows(new Date())), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${DEMO_CSV_FILENAME}"`,
      "Cache-Control": "no-store",
    },
  });
}
