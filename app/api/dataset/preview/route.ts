import { NextResponse } from "next/server";
import { quoteIdent, runClickhouseQuery } from "@/lib/clickhouse";
import {
  DEMO_COLUMNS,
  DEMO_SOURCE_ID,
  getDemoPreview,
} from "@/lib/demo-data";
import { loadFileSource } from "@/lib/file-source-server";
import {
  collectIdentifiers,
  computeAggregateFlags,
  enrichRowsWithCalculated,
  prepareCalculatedFields,
  resolveCalcRefs,
  stripAggregates,
  topoSortCalculatedFields,
  type PreparedField,
} from "@/lib/formula";
import {
  createServerSupabaseClient,
  getAuthenticatedUser,
} from "@/lib/server-auth";
import {
  friendlyClickhouseError,
  resolveDataSource,
} from "@/lib/data-source-server";
import {
  containsDangerousSQL,
  validateTableName,
} from "@/lib/sql-validator";
import type { CalculatedField, QueryResultRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Сколько строк показываем в превью датасета — фиксировано. */
const PREVIEW_LIMIT = 50;
/** Превью должно быть быстрым: запрос дольше 5 c — таймаут с понятной ошибкой. */
const PREVIEW_TIMEOUT_MS = 5_000;

interface Body {
  dataSourceId?: string;
  table?: string | null;
  sqlQuery?: string | null;
  isDemo?: boolean;
  /** Вычисляемые поля датасета — применяются row-level к строкам превью. */
  calculatedFields?: CalculatedField[];
}

interface PreviewColumn {
  name: string;
  /** datasetType row-level calc-полей = "float"/"integer"; для сырых — clickhouse-тип. */
  type: string;
  isCalculated?: boolean;
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const isDemo =
    Boolean(body.isDemo) || body.dataSourceId === DEMO_SOURCE_ID;

  // --- Подготовка вычисляемых полей. ---
  // row-level — считаются как обычно. aggregate-level — для ПРЕВЬЮ
  // «понижаются» до row-level через stripAggregates (SUM([a]+[b]) → [a]+[b],
  // COUNT(*) → 1 и т.п.), чтобы пользователь видел значения построчно.
  // В визуализациях с группировкой агрегаты по-прежнему считаются полноценно.
  const allFields = body.calculatedFields ?? [];
  const prepared = prepareCalculatedFields(allFields);
  const preparedMap = new Map(prepared.map((p) => [p.field.name, p]));
  const aggFlags = computeAggregateFlags(prepared);
  const rowLevelOrdered = topoSortCalculatedFields(
    prepared.filter((p) => aggFlags.get(p.field.name) !== true),
  );
  const rowFallbackPrepared: PreparedField[] = prepared
    .filter((p) => aggFlags.get(p.field.name) === true)
    .map((p) => {
      const ast = stripAggregates(resolveCalcRefs(p.ast, preparedMap));
      return { field: p.field, ast, refs: collectIdentifiers(ast) };
    });
  const rowFallbackFieldNames = rowFallbackPrepared.map((p) => p.field.name);
  // Агрегаты, которые НЕ удалось понизить до row-level (сейчас таких нет —
  // всё, включая COUNT(*), сводится к row-выражению или к 1).
  const aggregateFieldNames: string[] = [];

  try {
    let rawRows: QueryResultRow[] = [];
    // Имя сырой колонки → её тип (clickhouse-тип или demo datasetType).
    const rawColumnTypes = new Map<string, string>();

    if (isDemo) {
      const table = body.table ?? "campaigns";
      rawRows = getDemoPreview(table, PREVIEW_LIMIT);
      for (const c of DEMO_COLUMNS[table] ?? []) {
        rawColumnTypes.set(c.name, c.type);
      }
    } else {
      if (!body.dataSourceId) {
        return NextResponse.json(
          { error: "Не указан источник данных" },
          { status: 400 },
        );
      }
      const supabase = createServerSupabaseClient();

      // Файловый источник: превью из сохранённых строк (без ClickHouse).
      const fileSrc = await loadFileSource(supabase, body.dataSourceId);
      if (fileSrc) {
        rawRows = fileSrc.rows.slice(0, PREVIEW_LIMIT);
        for (const c of fileSrc.columns) rawColumnTypes.set(c.name, c.type);
      } else {
        if (body.table && !validateTableName(body.table)) {
          return NextResponse.json(
            { error: "Недопустимое имя таблицы" },
            { status: 400 },
          );
        }
        if (body.sqlQuery && containsDangerousSQL(body.sqlQuery)) {
          return NextResponse.json(
            { error: "Запрос содержит запрещённые операции (DROP/DELETE/…)" },
            { status: 400 },
          );
        }
        const fromSql = body.sqlQuery
          ? `(${body.sqlQuery.trim().replace(/;$/, "")})`
          : null;
        if (!fromSql && !body.table) {
          return NextResponse.json(
            { error: "Нет таблицы или SQL-запроса в датасете" },
            { status: 400 },
          );
        }
        const resolved = await resolveDataSource(supabase, body.dataSourceId);
        if (!resolved.ok) {
          return NextResponse.json(
            { error: resolved.error },
            { status: resolved.status },
          );
        }
        const creds = resolved.creds;
        const from =
          fromSql ??
          `${quoteIdent(creds.database)}.${quoteIdent(body.table as string)}`;
        const res = await runClickhouseQuery(
          creds,
          `SELECT * FROM ${from} LIMIT ${PREVIEW_LIMIT}`,
          { timeoutMs: PREVIEW_TIMEOUT_MS },
        );
        if (!res.ok) {
          const msg = res.error;
          const friendly =
            /aborted|ETIMEDOUT|timeout/i.test(msg)
              ? "Превью загружается слишком долго. Попробуйте упростить SQL-запрос."
              : friendlyClickhouseError(msg, {
                  tableName: body.table ?? undefined,
                });
          return NextResponse.json({ error: friendly }, { status: 502 });
        }
        const parsed = JSON.parse(res.data) as {
          data: QueryResultRow[];
          meta?: { name: string; type: string }[];
        };
        rawRows = parsed.data ?? [];
        for (const m of parsed.meta ?? []) rawColumnTypes.set(m.name, m.type);
      }
    }

    // Порядок сырых колонок: из meta (если есть), иначе из первой строки.
    const rawColumnNames =
      rawColumnTypes.size > 0
        ? Array.from(rawColumnTypes.keys())
        : rawRows.length > 0
          ? Object.keys(rawRows[0])
          : [];
    const columns: PreviewColumn[] = rawColumnNames.map((name) => ({
      name,
      type: rawColumnTypes.get(name) ?? "",
    }));

    // Применяем row-level calc-поля + «понижённые» aggregate-поля к строкам.
    const ordered = [...rowLevelOrdered, ...rowFallbackPrepared];
    const rows =
      ordered.length > 0 ? enrichRowsWithCalculated(rawRows, ordered) : rawRows;

    // Добавляем calc-поля (и row-level, и aggregate) в список колонок —
    // aggregate-поля показываются с пустыми ячейками + поясняющим тултипом.
    const rawSet = new Set(rawColumnNames);
    for (const f of allFields) {
      if (rawSet.has(f.name)) continue;
      columns.push({
        name: f.name,
        type: f.datasetType,
        isCalculated: true,
      });
    }

    return NextResponse.json({
      rows,
      columns,
      rowCount: rows.length,
      aggregateFieldNames,
      rowFallbackFieldNames,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const friendly = /aborted|ETIMEDOUT|timeout/i.test(msg)
      ? "Превью загружается слишком долго. Попробуйте упростить SQL-запрос."
      : friendlyClickhouseError(msg);
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}
