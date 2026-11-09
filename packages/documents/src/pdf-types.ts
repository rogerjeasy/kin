/** One column of a table. `width` is relative: columns share the page width in proportion. */
export type PdfTableColumn = { readonly title: string; readonly width: number; readonly align: "left" | "right" };

export type PdfBlock =
  | { readonly type: "heading"; readonly level: 1 | 2; readonly text: string }
  | { readonly type: "paragraph"; readonly text: string }
  | { readonly type: "bullets"; readonly items: readonly string[] }
  | { readonly type: "keyValues"; readonly rows: readonly (readonly [label: string, value: string])[] }
  /** A header row that repeats on every page, and rows that are never split across pages. `mono` sets the cells in Courier. */
  | { readonly type: "table"; readonly columns: readonly PdfTableColumn[]; readonly rows: readonly (readonly string[])[]; readonly mono?: boolean }
  /** Vertical space in points; 10 when left out. */
  | { readonly type: "spacer"; readonly height?: number }
  | { readonly type: "pageBreak" }
  /** Preformatted lines in Courier, kept as written and broken by character only when a line is wider than the page. */
  | { readonly type: "monoLines"; readonly lines: readonly string[] };

export type PdfDocument = {
  readonly title: string;
  readonly author: string;
  /** Passed in, never read from a clock, so the same document is the same bytes. */
  readonly created: Date;
  /** Shown at the foot of every page beside "Page N of M". */
  readonly footer: string;
  readonly blocks: readonly PdfBlock[];
};

/** The document cannot be laid out as given, such as a table row with the wrong number of cells. Retrying cannot help. */
export class PdfDocumentError extends Error {
  readonly retryable = false;

  constructor(what: string) {
    super(`PDF document is invalid: ${what}`);
    this.name = "PdfDocumentError";
  }
}
