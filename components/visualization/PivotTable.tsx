"use client";

import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  Calculator,
  ChevronsUpDown,
  TableProperties,
} from "lucide-react";
import type {
  CalculatedField,
  CalculatedFieldFormat,
  DatasetColumn,
  PivotValueConfig,
  QueryResultRow,
} from "@/lib/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { valueKey } from "@/lib/aggregation";
import { formatNumber, cn } from "@/lib/utils";
import { getSortingFnFor } from "@/lib/sorting";
import {
  AGGREGATION_LABEL,
  columnLabel,
  formatCalculatedValue,
  formatDateTooltip,
  isIsoDateValue,
  resolveValueFormat,
  type LabelContext,
} from "@/lib/format-value";

interface Props {
  data: QueryResultRow[];
  rows: string[];
  columns: string[];
  values: PivotValueConfig[];
  /** Метаданные колонок датасета — для маппинга типов на sortingFn. */
  datasetColumns?: DatasetColumn[];
  /**
   * Объединённый список вычисляемых полей (dataset + viz). Используется,
   * чтобы (1) подсветить заголовок иконкой fx и (2) применить format
   * при отображении ячейки.
   */
  calculatedFields?: CalculatedField[];
  /** Формат значений, выбранный в визуализации (`config.valueFormats`). */
  valueFormats?: Record<string, CalculatedFieldFormat>;
}

const FLAT_LIMIT = 500;
const PIVOT_ROW_LIMIT = 300;

export function PivotTable({
  data,
  rows,
  columns,
  values,
  datasetColumns,
  calculatedFields,
  valueFormats,
}: Props) {
  if (values.length === 0) {
    return (
      <EmptyState
        title="Здесь будет таблица"
        hint="Добавьте минимум одно значение в зону «Значения» слева"
      />
    );
  }

  if (columns.length === 0) {
    return (
      <FlatPivotTable
        data={data}
        rows={rows}
        values={values}
        datasetColumns={datasetColumns}
        calculatedFields={calculatedFields}
        valueFormats={valueFormats}
      />
    );
  }

  return (
    <TruePivotTable
      data={data}
      rows={rows}
      columns={columns}
      values={values}
      datasetColumns={datasetColumns}
      calculatedFields={calculatedFields}
      valueFormats={valueFormats}
    />
  );
}

// -------------------------------------------------------------
// Flat table (без столбцов-измерений) — обычная таблица
// -------------------------------------------------------------

function FlatPivotTable({
  data,
  rows,
  values,
  datasetColumns,
  calculatedFields,
  valueFormats,
}: {
  data: QueryResultRow[];
  rows: string[];
  values: PivotValueConfig[];
  datasetColumns?: DatasetColumn[];
  calculatedFields?: CalculatedField[];
  valueFormats?: Record<string, CalculatedFieldFormat>;
}) {
  const columnTypeMap = useMemo(
    () =>
      new Map((datasetColumns ?? []).map((c) => [c.name, c.datasetType])),
    [datasetColumns],
  );
  const calcFieldMap = useMemo(
    () =>
      new Map((calculatedFields ?? []).map((c) => [c.name, c] as const)),
    [calculatedFields],
  );
  const labelCtx: LabelContext = useMemo(
    () => ({ datasetColumns, calculatedFields }),
    [datasetColumns, calculatedFields],
  );

  const tableColumns = useMemo<ColumnDef<QueryResultRow>[]>(() => {
    const dimCols: ColumnDef<QueryResultRow>[] = rows.map((r) => {
      const calc = calcFieldMap.get(r);
      return {
        id: r,
        header: () => <DimHeader name={columnLabel(r, labelCtx)} isCalc={!!calc} />,
        accessorFn: (row) => normalizeForSort(row[r]),
        cell: ({ row }) =>
          calc
            ? formatCalcCell(row.original[r], calc.format)
            : formatDimensionCell(row.original[r], isDateType(columnTypeMap.get(r))),
        sortingFn: getSortingFnFor(columnTypeMap.get(r) ?? calc?.datasetType),
        sortDescFirst: false,
        sortUndefined: "last" as const,
        enableSorting: true,
        meta: { numeric: !!calc } as ColumnMeta,
      };
    });

    const valCols: ColumnDef<QueryResultRow>[] = values.map((v) => {
      const key = valueKey(v);
      const calc = calcFieldMap.get(v.column);
      const fmt = resolveValueFormat(v, { valueFormats, calculatedFields });
      return {
        id: key,
        header: () => <ValueHeader v={v} isCalc={!!calc} labelCtx={labelCtx} />,
        accessorFn: (row) => normalizeForSort(row[key]),
        cell: ({ row }) =>
          calc || fmt
            ? formatCalcCell(row.original[key], fmt)
            : formatValueCell(row.original[key]),
        sortingFn: "basic" as const,
        sortDescFirst: false,
        sortUndefined: "last" as const,
        enableSorting: true,
        meta: { numeric: true } as ColumnMeta,
      };
    });

    return [...dimCols, ...valCols];
  }, [rows, values, columnTypeMap, calcFieldMap, valueFormats, calculatedFields, labelCtx]);

  // Дефолтная сортировка: первая дата-колонка из rows — desc (новые сверху).
  const initialSorting = useMemo<SortingState>(() => {
    for (const r of rows) {
      const t = columnTypeMap.get(r);
      if (t === "date" || t === "datetime") {
        return [{ id: r, desc: true }];
      }
    }
    return [];
  }, [rows, columnTypeMap]);

  const [sorting, setSorting] = useState<SortingState>(initialSorting);

  const limitedData = useMemo(() => data.slice(0, FLAT_LIMIT), [data]);

  const table = useReactTable({
    data: limitedData,
    columns: tableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: true,
  });

  if (data.length === 0) {
    return (
      <EmptyState
        title="Нет данных"
        hint="Запрос вернулся пустым. Проверьте фильтры и параметры датасета."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {table.getFlatHeaders().map((header) => {
            const isNumeric = (header.column.columnDef.meta as ColumnMeta | undefined)
              ?.numeric;
            const sortDir = header.column.getIsSorted();
            return (
              <TableHead
                key={header.id}
                className={cn(
                  "cursor-pointer select-none transition-colors hover:bg-muted/40",
                  isNumeric && "text-right",
                  sortDir && "text-primary",
                )}
                onClick={header.column.getToggleSortingHandler()}
                aria-sort={
                  sortDir === "asc"
                    ? "ascending"
                    : sortDir === "desc"
                      ? "descending"
                      : "none"
                }
              >
                <div
                  className={cn(
                    "flex items-center gap-1.5",
                    isNumeric && "justify-end",
                  )}
                >
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                  <SortIcon direction={sortDir} />
                </div>
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            className="hover:shadow-[inset_2px_0_0_hsl(var(--primary)/0.4)]"
          >
            {row.getVisibleCells().map((cell) => {
              const isNumeric = (
                cell.column.columnDef.meta as ColumnMeta | undefined
              )?.numeric;
              return (
                <TableCell
                  key={cell.id}
                  className={cn(
                    isNumeric
                      ? "text-right font-mono text-sm tabular-nums"
                      : "text-sm text-foreground/90",
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// -------------------------------------------------------------
// True pivot (есть столбцы-измерения) — двойной заголовок
// -------------------------------------------------------------

function TruePivotTable({
  data,
  rows,
  columns,
  values,
  datasetColumns,
  calculatedFields,
  valueFormats,
}: {
  data: QueryResultRow[];
  rows: string[];
  columns: string[];
  values: PivotValueConfig[];
  datasetColumns?: DatasetColumn[];
  calculatedFields?: CalculatedField[];
  valueFormats?: Record<string, CalculatedFieldFormat>;
}) {
  const columnTypeMap = useMemo(
    () =>
      new Map((datasetColumns ?? []).map((c) => [c.name, c.datasetType])),
    [datasetColumns],
  );
  const calcFieldMap = useMemo(
    () =>
      new Map((calculatedFields ?? []).map((c) => [c.name, c] as const)),
    [calculatedFields],
  );
  const labelCtx: LabelContext = useMemo(
    () => ({ datasetColumns, calculatedFields }),
    [datasetColumns, calculatedFields],
  );

  const { tableData, colKeys } = useMemo(() => {
    const cks = Array.from(
      new Set(data.map((r) => columns.map((c) => String(r[c] ?? "")).join(" · "))),
    ).sort((a, b) => a.localeCompare(b, ["ru", "en"]));

    // Один проход по data: запоминаем порядок rowKey + первую попавшуюся
    // строку с этим rk (для извлечения значений row-измерений) + ячейки.
    const dimRowMap = new Map<string, QueryResultRow>();
    const cellLookup = new Map<string, QueryResultRow>();
    const orderedRks: string[] = [];
    for (const r of data) {
      const rk = rows.map((c) => String(r[c] ?? "")).join("\u0001");
      const ck = columns.map((c) => String(r[c] ?? "")).join(" · ");
      cellLookup.set(`${rk}||${ck}`, r);
      if (!dimRowMap.has(rk)) {
        dimRowMap.set(rk, r);
        orderedRks.push(rk);
      }
    }

    const rowKeys = orderedRks.slice(0, PIVOT_ROW_LIMIT);

    const td: QueryResultRow[] = rowKeys.map((rk) => {
      const orig = dimRowMap.get(rk);
      const parts = rk.split("\u0001");
      const out: QueryResultRow = {};
      rows.forEach((rname, i) => {
        out[rname] = orig ? orig[rname] : (parts[i] ?? null);
      });
      for (const ck of cks) {
        const r = cellLookup.get(`${rk}||${ck}`);
        for (const v of values) {
          const k = valueKey(v);
          out[`${ck}\u0002${k}`] = r ? r[k] : null;
        }
      }
      return out;
    });

    return { tableData: td, colKeys: cks };
  }, [data, rows, columns, values]);

  const tableColumns = useMemo<ColumnDef<QueryResultRow>[]>(() => {
    const dimCols: ColumnDef<QueryResultRow>[] = rows.map((r) => {
      const calc = calcFieldMap.get(r);
      return {
        id: r,
        header: () => <DimHeader name={columnLabel(r, labelCtx)} isCalc={!!calc} />,
        accessorFn: (row) => normalizeForSort(row[r]),
        cell: ({ row }) =>
          calc
            ? formatCalcCell(row.original[r], calc.format)
            : formatDimensionCell(row.original[r], isDateType(columnTypeMap.get(r))),
        sortingFn: getSortingFnFor(columnTypeMap.get(r) ?? calc?.datasetType),
        sortDescFirst: false,
        sortUndefined: "last" as const,
        enableSorting: true,
      };
    });

    const cellCols: ColumnDef<QueryResultRow>[] = colKeys.flatMap((ck) =>
      values.map((v) => {
        const k = valueKey(v);
        const cellId = `${ck}\u0002${k}`;
        const calc = calcFieldMap.get(v.column);
        const fmt = resolveValueFormat(v, { valueFormats, calculatedFields });
        return {
          id: cellId,
          header: () => (
            <ValueHeader v={v} colKey={colKeyLabel(ck)} isCalc={!!calc} labelCtx={labelCtx} />
          ),
          accessorFn: (row) => normalizeForSort(row[cellId]),
          cell: ({ row }) =>
            calc || fmt
              ? formatCalcCell(row.original[cellId], fmt)
              : formatValueCell(row.original[cellId]),
          sortingFn: "basic" as const,
          sortDescFirst: false,
          sortUndefined: "last" as const,
          enableSorting: true,
          meta: { numeric: true } as ColumnMeta,
        };
      }),
    );

    return [...dimCols, ...cellCols];
  }, [rows, colKeys, values, columnTypeMap, calcFieldMap, valueFormats, calculatedFields, labelCtx]);

  const initialSorting = useMemo<SortingState>(() => {
    for (const r of rows) {
      const t = columnTypeMap.get(r);
      if (t === "date" || t === "datetime") {
        return [{ id: r, desc: true }];
      }
    }
    return [];
  }, [rows, columnTypeMap]);

  const [sorting, setSorting] = useState<SortingState>(initialSorting);

  const table = useReactTable({
    data: tableData,
    columns: tableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: true,
  });

  if (data.length === 0) {
    return (
      <EmptyState
        title="Нет данных"
        hint="Запрос вернулся пустым. Проверьте фильтры и параметры датасета."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        {/* Верхняя строка: имена row-измерений (rowSpan=2) + объединённые colKeys */}
        <TableRow>
          {rows.map((r) => {
            const col = table.getColumn(r);
            const sortDir = col?.getIsSorted();
            return (
              <TableHead
                key={r}
                rowSpan={2}
                className={cn(
                  "cursor-pointer select-none align-middle transition-colors hover:bg-muted/40",
                  sortDir && "text-primary",
                )}
                onClick={col?.getToggleSortingHandler()}
                aria-sort={
                  sortDir === "asc"
                    ? "ascending"
                    : sortDir === "desc"
                      ? "descending"
                      : "none"
                }
              >
                <div className="flex items-center gap-1.5">
                  <span className="normal-case tracking-normal">{columnLabel(r, labelCtx)}</span>
                  <SortIcon direction={sortDir} />
                </div>
              </TableHead>
            );
          })}
          {colKeys.map((ck) => (
            <TableHead
              key={ck}
              colSpan={values.length}
              className="border-l border-border/60 text-center"
            >
              <span className="font-mono text-[11px] normal-case tracking-normal text-foreground/80">
                {colKeyLabel(ck) || "—"}
              </span>
            </TableHead>
          ))}
        </TableRow>
        {/* Нижняя строка: per-value заголовки (правый край каждого colKey-блока) */}
        <TableRow>
          {colKeys.flatMap((ck) =>
            values.map((v) => {
              const cellId = `${ck}\u0002${valueKey(v)}`;
              const col = table.getColumn(cellId);
              const sortDir = col?.getIsSorted();
              return (
                <TableHead
                  key={cellId}
                  className={cn(
                    "cursor-pointer select-none border-l border-border/60 text-right transition-colors hover:bg-muted/40",
                    sortDir && "text-primary",
                  )}
                  onClick={col?.getToggleSortingHandler()}
                  aria-sort={
                    sortDir === "asc"
                      ? "ascending"
                      : sortDir === "desc"
                        ? "descending"
                        : "none"
                  }
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <ValueHeader
                      v={v}
                      compact
                      isCalc={calcFieldMap.has(v.column)}
                      labelCtx={labelCtx}
                    />
                    <SortIcon direction={sortDir} />
                  </div>
                </TableHead>
              );
            }),
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            className="hover:shadow-[inset_2px_0_0_hsl(var(--primary)/0.4)]"
          >
            {row.getVisibleCells().map((cell) => {
              const isNumeric = (
                cell.column.columnDef.meta as ColumnMeta | undefined
              )?.numeric;
              return (
                <TableCell
                  key={cell.id}
                  className={cn(
                    isNumeric
                      ? "border-l border-border/60 text-right font-mono text-sm tabular-nums"
                      : "text-sm text-foreground/90",
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// -------------------------------------------------------------
// helpers
// -------------------------------------------------------------

interface ColumnMeta {
  numeric?: boolean;
}

function ValueHeader({
  v,
  colKey,
  compact,
  isCalc,
  labelCtx,
}: {
  v: PivotValueConfig;
  colKey?: string;
  compact?: boolean;
  isCalc?: boolean;
  labelCtx: LabelContext;
}) {
  // Человеческое название; агрегация по-русски — только у сырых колонок
  // (вычисляемые поля и поля плана агрегируют сами).
  return (
    <div className={cn("flex flex-col leading-tight", compact ? "items-end" : "items-end")}>
      {colKey ? (
        <span className="text-[10px] normal-case tracking-normal text-muted-foreground/80">
          {colKey}
        </span>
      ) : null}
      <span className="flex items-center gap-1 text-xs font-medium normal-case tracking-normal text-foreground">
        {isCalc && (
          <Calculator
            className="h-3 w-3 text-primary shrink-0"
            aria-label="Вычисляемое поле"
          />
        )}
        {columnLabel(v.column, labelCtx)}
      </span>
      {!isCalc && (
        <span className="text-[10px] normal-case tracking-normal text-muted-foreground">
          {AGGREGATION_LABEL[v.aggregation] ?? v.aggregation}
        </span>
      )}
    </div>
  );
}

function DimHeader({ name, isCalc }: { name: string; isCalc?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 normal-case tracking-normal">
      {isCalc && (
        <Calculator
          className="h-3 w-3 text-primary shrink-0"
          aria-label="Вычисляемое поле"
        />
      )}
      {name}
    </span>
  );
}

function SortIcon({ direction }: { direction: false | "asc" | "desc" | undefined }) {
  if (direction === "asc") {
    return <ArrowUp className="h-3 w-3 text-primary" aria-hidden />;
  }
  if (direction === "desc") {
    return <ArrowDown className="h-3 w-3 text-primary" aria-hidden />;
  }
  return (
    <ChevronsUpDown className="h-3 w-3 text-muted-foreground/40" aria-hidden />
  );
}

function formatDimensionCell(v: unknown, isDate?: boolean): React.ReactNode {
  if (v === null || v === undefined || v === "") {
    return <span className="text-muted-foreground/50">—</span>;
  }
  return isDate ? formatDateTooltip(v) : String(v);
}

function isDateType(t: string | undefined): boolean {
  return t === "date" || t === "datetime";
}

/** Подпись столбца сводной: значения-даты — по-русски («02.10.2026», «окт 2026»). */
function colKeyLabel(ck: string): string {
  return ck
    .split(" · ")
    .map((part) => (isIsoDateValue(part) ? formatDateTooltip(part) : part))
    .join(" · ");
}

function formatValueCell(v: unknown): React.ReactNode {
  if (v === null || v === undefined) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  if (typeof v === "number") {
    return formatNumber(v, v % 1 === 0 ? 0 : 2);
  }
  return String(v);
}

function formatCalcCell(
  v: unknown,
  format: CalculatedFieldFormat | undefined,
): React.ReactNode {
  if (v === null || v === undefined) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  const num = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(num)) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  return formatCalculatedValue(num, format);
}

/**
 * Приводим `null`/пустую строку → `undefined`, чтобы TanStack
 * с `sortUndefined: 'last'` помещал такие значения в конец списка
 * вне зависимости от направления сортировки.
 */
function normalizeForSort(v: unknown): unknown {
  if (v === null || v === "") return undefined;
  return v;
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/10 py-20 text-center">
      <TableProperties className="h-9 w-9 text-muted-foreground/40" aria-hidden />
      <div className="text-base font-medium text-foreground">{title}</div>
      <div className="max-w-xs text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
