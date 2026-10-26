import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runClickhouseQuery, quoteIdent } from "@/lib/clickhouse";
import { DEMO_SOURCE_ID, DEMO_TABLE, getDemoDataAt } from "@/lib/demo-data";
import {
  friendlyClickhouseError,
  resolveDataSource,
} from "@/lib/data-source-server";
import { loadFileSource } from "@/lib/file-source-server";
import {
  attachPlanColumns,
  buildMainSql,
  buildPlanDatesSql,
  datesByGroupFromDateRows,
  planDailyFactsFromDateRows,
  prepareQuery,
  runInJs,
  validateForSql,
  type QueryBody,
} from "@/lib/query-engine";
import type { QueryResultRow } from "@/lib/types";

export type { QueryBody } from "@/lib/query-engine";

/** Ответ движка: HTTP-статус и тело (как у `/api/query`). */
export interface QueryOutcome {
  status: number;
  body: { data?: QueryResultRow[]; error?: string; warning?: string };
}

export interface QueryDeps {
  /**
   * Supabase-клиент для файловых источников и кредов ClickHouse. Создаётся
   * лениво (демо он не нужен): в `/api/query` — под сессией пользователя,
   * в сводке плана — service role.
   */
  supabase: () => SupabaseClient;
  /** «Сейчас» для полей плана. */
  today: Date;
}

const ok = (data: QueryResultRow[]): QueryOutcome => ({ status: 200, body: { data } });
const fail = (status: number, error: string): QueryOutcome => ({
  status,
  body: { error },
});

/**
 * Исполняет запрос на демо, файловом или ClickHouse-источнике. Исключения не
 * ловит — вызывающий код превращает их в 500 с понятным текстом.
 */
export async function executeQuery(
  body: QueryBody,
  deps: QueryDeps,
): Promise<QueryOutcome> {
  const isDemo =
    Boolean(body.source?.isDemo) || body.dataSourceId === DEMO_SOURCE_ID;
  const q = prepareQuery(body);

  // ВНИМАНИЕ: SQL-валидация имён (таблица/столбцы/фильтры) и опасных
  // ключевиков — только в ветке ClickHouse. Демо- и файловые источники
  // (CSV/Excel/Google Sheets) считаются in-JS: имена столбцов — это ключи
  // объектов, а не SQL, поэтому им допустимы заголовки с пробелами и кириллицей.

  if (isDemo) {
    const table = body.table ?? DEMO_TABLE;
    // Демо-строки на тот же «сейчас», что и поля плана (кеш по дню — дёшево).
    const all = getDemoDataAt(deps.today)[table] ?? [];
    return ok(runInJs(all, q, body.limit, deps.today));
  }

  const supabase = deps.supabase();

  // Файловый источник (CSV/Excel/Google Sheets): данные лежат в Supabase,
  // считаем in-JS теми же агрегаторами, что и демо-режим. Если это не
  // файловый источник — loadFileSource вернёт null, идём по ветке ClickHouse.
  const fileSrc = await loadFileSource(supabase, body.dataSourceId);
  if (fileSrc) {
    return ok(runInJs(fileSrc.rows, q, body.limit, deps.today));
  }

  // SQL-режим (ClickHouse): валидируем идентификаторы и кастомный SQL ПЕРЕД
  // построением запроса.
  const invalid = validateForSql(q, body);
  if (invalid) return fail(400, invalid);

  const resolved = await resolveDataSource(supabase, body.dataSourceId);
  if (!resolved.ok) return fail(resolved.status, resolved.error);
  const creds = resolved.creds;

  const fromClause = body.sqlQuery
    ? `(${body.sqlQuery.trim().replace(/;$/, "")})`
    : body.table
      ? `${quoteIdent(creds.database)}.${quoteIdent(body.table)}`
      : null;
  if (!fromClause) return fail(400, "Нет таблицы или SQL в датасете");

  const res = await runClickhouseQuery(creds, buildMainSql(q, fromClause, body.limit));
  if (!res.ok) return fail(502, friendlyClickhouseError(res.error));
  const parsed = JSON.parse(res.data) as { data: QueryResultRow[] };
  if (!q.plan) return ok(parsed.data);

  // Поля плана: даты групп — вторичным запросом с теми же фильтрами
  // (если группировка не по дате — тогда дата уже есть в каждой строке).
  const datesSql = buildPlanDatesSql(q, fromClause);
  let datesByKey: Map<string, string[]> | null = null;
  let factsByKey: ReturnType<typeof planDailyFactsFromDateRows>["factsByKey"] = null;
  let warning: string | undefined;
  if (datesSql) {
    const dres = await runClickhouseQuery(creds, datesSql);
    if (!dres.ok) return fail(502, friendlyClickhouseError(dres.error));
    const dparsed = JSON.parse(dres.data) as { data: QueryResultRow[] };
    datesByKey = datesByGroupFromDateRows(dparsed.data, q.groupBy);
    ({ factsByKey, warning } = planDailyFactsFromDateRows(dparsed.data, q));
  }
  const rows = attachPlanColumns(parsed.data, datesByKey, q, deps.today, factsByKey);
  return warning ? { status: 200, body: { data: rows, warning } } : ok(rows);
}
