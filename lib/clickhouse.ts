import { CLICKHOUSE_STRUCTURE_QUERY_TIMEOUT_MS } from "./clickhouse-errors";
import type { ColumnInfo, QueryResultRow, TableInfo } from "./types";

interface Credentials {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

function buildBaseUrl(c: Credentials): string {
  const proto = c.ssl ? "https" : "http";
  const cleanHost = c.host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `${proto}://${cleanHost}:${c.port}`;
}

function buildAuthHeader(c: Credentials): Record<string, string> {
  const token = Buffer.from(`${c.user}:${c.password}`, "utf-8").toString(
    "base64",
  );
  return { Authorization: `Basic ${token}` };
}

export async function runClickhouseQuery(
  creds: Credentials,
  query: string,
  options: { format?: "JSON" | "TabSeparated"; timeoutMs?: number } = {},
): Promise<{ ok: true; data: string } | { ok: false; error: string }> {
  const format = options.format ?? "JSON";
  const timeoutMs = options.timeoutMs ?? 10000;
  const url = buildBaseUrl(creds);
  const finalQuery = `${query} FORMAT ${format}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        ...buildAuthHeader(creds),
      },
      body: finalQuery,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: text || `HTTP ${res.status}` };
    }
    return { ok: true, data: text };
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function testConnection(creds: Credentials) {
  return runClickhouseQuery(creds, "SELECT 1 AS ok");
}

export async function fetchTables(
  creds: Credentials,
  options: { timeoutMs?: number } = {},
): Promise<TableInfo[]> {
  const q = `SELECT name, engine, total_rows FROM system.tables WHERE database = '${escapeSql(creds.database)}' ORDER BY name`;
  const res = await runClickhouseQuery(creds, q, {
    timeoutMs: options.timeoutMs,
  });
  if (!res.ok) throw new Error(res.error);
  let parsed: { data: Array<{ name: string; engine: string; total_rows: number | string }> };
  try {
    parsed = JSON.parse(res.data);
  } catch (e) {
    throw new Error(
      `parse: не удалось разобрать ответ ClickHouse: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return parsed.data.map((r) => ({
    name: r.name,
    engine: r.engine,
    totalRows: Number(r.total_rows),
  }));
}

export async function fetchColumns(
  creds: Credentials,
  table: string,
  options: { timeoutMs?: number } = {},
): Promise<ColumnInfo[]> {
  const db = quoteIdent(creds.database);
  const tbl = quoteIdent(table);
  const q = `DESCRIBE TABLE ${db}.${tbl}`;
  const res = await runClickhouseQuery(creds, q, {
    timeoutMs: options.timeoutMs ?? CLICKHOUSE_STRUCTURE_QUERY_TIMEOUT_MS,
  });
  if (!res.ok) throw new Error(res.error);
  const parsed = JSON.parse(res.data) as {
    data: Array<{ name: string; type: string }>;
  };
  return parsed.data.map((r) => ({
    name: r.name,
    type: r.type,
  }));
}

export async function fetchPreview(
  creds: Credentials,
  table: string,
  limit = 100,
): Promise<QueryResultRow[]> {
  const q = `SELECT * FROM ${quoteIdent(creds.database)}.${quoteIdent(table)} LIMIT ${Math.max(1, Math.min(1000, limit))}`;
  const res = await runClickhouseQuery(creds, q);
  if (!res.ok) throw new Error(res.error);
  const parsed = JSON.parse(res.data) as { data: QueryResultRow[] };
  return parsed.data;
}

export function escapeSql(s: string): string {
  return s.replace(/'/g, "''").replace(/\\/g, "\\\\");
}

export function quoteIdent(s: string): string {
  return "`" + s.replace(/`/g, "``") + "`";
}

export type { Credentials };
