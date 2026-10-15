import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type Column = {
  key: string;
  header: string;
  /** Amounts line up at the end of the cell. */
  align?: "end";
};

export type Row = { id: string; cells: Record<string, ReactNode> };

type DataTableProps = {
  /** Names the table for a screen reader. */
  caption: string;
  columns: readonly Column[];
  rows: readonly Row[];
  /** On a phone, this column heads each card and the last column sits beside it. */
  primary: string;
};

/**
 * A table on a wide screen. On a phone the same rows become stacked cards, so
 * nothing is squeezed or scrolled sideways (AGENTS.md section 8).
 */
export function DataTable({ caption, columns, rows, primary }: DataTableProps) {
  const last = columns.at(-1);
  const others = columns.filter((column) => column.key !== primary && column !== last);

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-start text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-y bg-muted/60 text-muted-foreground">
              {columns.map((column) => (
                <th key={column.key} scope="col" className={cn("px-4 py-3 font-medium first:ps-6 last:pe-6", column.align === "end" ? "text-end" : "text-start")}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id} className="transition-colors hover:bg-muted/40">
                {columns.map((column) => (
                  <td key={column.key} className={cn("px-4 py-3.5 align-top first:ps-6 last:pe-6", column.align === "end" && "text-end tabular-nums")}>
                    {row.cells[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={caption} className="divide-y border-t md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">{row.cells[primary]}</div>
              {last ? <div className="shrink-0 text-end font-semibold tabular-nums">{row.cells[last.key]}</div> : null}
            </div>
            {others.length > 0 ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {others.map((column) => (
                  <div key={column.key} className="min-w-0">
                    <dt className="text-muted-foreground">{column.header}</dt>
                    <dd className="mt-0.5">{row.cells[column.key]}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
