import { PdfDocumentError, type PdfBlock, type PdfTableColumn } from "./pdf-types.ts";
import { FONTS, fitText, hardWrap, pdfString, textWidth, wrapText, type PdfFont } from "./pdf-text.ts";

/** US Letter, in points. */
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
const MARGIN_X = 54;
const TOP = PAGE_HEIGHT - 54;
const BOTTOM = 66;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X;
const FOOTER_BASELINE = 36;
const FOOTER_RULE = 50;
const FOOTER_SIZE = 8;

const BODY = { size: 10.5, leading: 14.5 };
const HEADINGS = { 1: { size: 16, leading: 20, before: 10, after: 6 }, 2: { size: 12.5, leading: 16, before: 6, after: 4 } } as const;
const BULLET_INDENT = 14;
const KEY_VALUE = { size: 10, leading: 13, padding: 2, labelShare: 0.32, gap: 8 };
const TABLE = { size: 9, leading: 11.5, padding: 4 };
const MONO = { size: 9, leading: 11.5 };
const DEFAULT_SPACER = 10;
// A heading is never the last thing on a page: room for this much of what follows it.
const KEEP_WITH_NEXT = 2 * BODY.leading;

const GRAY_TEXT = 0.35;
const GRAY_FILL = 0.92;
const GRAY_RULE = 0.75;

/** A number as it is written in a content stream: at most two decimals, never an exponent. */
function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function textOp(font: PdfFont, size: number, x: number, baseline: number, text: string, gray = 0): string {
  return `${num(gray)} g BT /${FONTS[font].resource} ${num(size)} Tf ${num(x)} ${num(baseline)} Td ${pdfString(text)} Tj ET 0 g`;
}

const fillOp = (x: number, top: number, width: number, height: number, gray: number): string => `${num(gray)} g ${num(x)} ${num(top - height)} ${num(width)} ${num(height)} re f 0 g`;

const ruleOp = (x1: number, x2: number, y: number, gray: number): string => `0.5 w ${num(gray)} G ${num(x1)} ${num(y)} m ${num(x2)} ${num(y)} l S 0 G`;

/**
 * Lays blocks out on Letter pages and returns each page's content stream
 * operations, without footers. Pagination is automatic: a heading stays with
 * the text after it, a table's header row repeats on each new page, and a
 * table row or key-value row is never split.
 */
export function layoutBlocks(blocks: readonly PdfBlock[]): string[][] {
  const pages: string[][] = [[]];
  let y = TOP;

  const page = (): string[] => pages[pages.length - 1] ?? [];
  const atTop = (): boolean => y === TOP;
  const newPage = (): void => {
    pages.push([]);
    y = TOP;
  };
  const ensure = (height: number): void => {
    if (y - height < BOTTOM && !atTop()) newPage();
  };
  const line = (font: PdfFont, size: number, leading: number, text: string, x = MARGIN_X, gray = 0): void => {
    ensure(leading);
    if (text !== "") page().push(textOp(font, size, x, y - size, text, gray));
    y -= leading;
  };
  const lines = (font: PdfFont, size: number, leading: number, text: readonly string[], x = MARGIN_X): void => {
    for (const each of text) line(font, size, leading, each, x);
  };

  function heading(level: 1 | 2, text: string): void {
    const style = HEADINGS[level];
    const wrapped = wrapText(text, "bold", style.size, CONTENT_WIDTH);
    ensure(style.before + wrapped.length * style.leading + KEEP_WITH_NEXT);
    if (!atTop()) y -= style.before;
    lines("bold", style.size, style.leading, wrapped);
    y -= style.after;
  }

  function bullets(items: readonly string[]): void {
    for (const item of items) {
      const wrapped = wrapText(item, "regular", BODY.size, CONTENT_WIDTH - BULLET_INDENT);
      wrapped.forEach((each, index) => {
        ensure(BODY.leading);
        // Only an item's first line carries the bullet; a continuation, even on a new page, is indented without one.
        if (index === 0) page().push(textOp("regular", BODY.size, MARGIN_X, y - BODY.size, "•"));
        line("regular", BODY.size, BODY.leading, each, MARGIN_X + BULLET_INDENT);
      });
    }
    y -= 4;
  }

  function keyValues(rows: readonly (readonly [string, string])[]): void {
    const labelWidth = CONTENT_WIDTH * KEY_VALUE.labelShare;
    const valueX = MARGIN_X + labelWidth + KEY_VALUE.gap;
    for (const [label, value] of rows) {
      const labelLines = wrapText(label, "bold", KEY_VALUE.size, labelWidth);
      const valueLines = wrapText(value, "regular", KEY_VALUE.size, CONTENT_WIDTH - labelWidth - KEY_VALUE.gap);
      const count = Math.max(labelLines.length, valueLines.length);
      ensure(count * KEY_VALUE.leading + KEY_VALUE.padding);
      labelLines.forEach((each, index) => each !== "" && page().push(textOp("bold", KEY_VALUE.size, MARGIN_X, y - KEY_VALUE.size - index * KEY_VALUE.leading, each)));
      valueLines.forEach((each, index) => each !== "" && page().push(textOp("regular", KEY_VALUE.size, valueX, y - KEY_VALUE.size - index * KEY_VALUE.leading, each)));
      y -= count * KEY_VALUE.leading + KEY_VALUE.padding;
    }
    y -= 4;
  }

  function table(columns: readonly PdfTableColumn[], rows: readonly (readonly string[])[], mono: boolean): void {
    if (columns.length === 0) throw new PdfDocumentError("a table has no columns");
    const total = columns.reduce((sum, column) => sum + column.width, 0);
    if (columns.some((column) => !(column.width > 0)) || !(total > 0)) throw new PdfDocumentError("a table column has no width");
    if (rows.some((row) => row.length !== columns.length)) throw new PdfDocumentError("a table row does not have one cell per column");
    const edges: number[] = [MARGIN_X];
    for (const column of columns) edges.push((edges.at(-1) ?? MARGIN_X) + (CONTENT_WIDTH * column.width) / total);
    const bodyFont: PdfFont = mono ? "mono" : "regular";
    const pad = TABLE.padding;
    const tallest = Math.floor((TOP - BOTTOM - 2 * pad - 2 * TABLE.leading) / TABLE.leading);

    const cellLines = (text: string, font: PdfFont, index: number, clamp: number): string[] => {
      const width = (edges[index + 1] ?? MARGIN_X) - (edges[index] ?? MARGIN_X) - 2 * pad;
      const wrapped = font === "mono" ? hardWrap(text.split("\n"), font, TABLE.size, width) : wrapText(text, font, TABLE.size, width);
      // A row that cannot fit on one whole page is cut rather than split.
      return wrapped.length > clamp ? [...wrapped.slice(0, clamp - 1), fitText(`${wrapped[clamp - 1] ?? ""}…`, font, TABLE.size, width)] : wrapped;
    };
    const rowLines = (cells: readonly string[], font: PdfFont): string[][] => cells.map((cell, index) => cellLines(cell, font, index, tallest));
    const heightOf = (laid: readonly string[][]): number => Math.max(1, ...laid.map((cell) => cell.length)) * TABLE.leading + 2 * pad;

    const header = rowLines(columns.map((column) => column.title), "bold");
    const headerHeight = heightOf(header);
    const draw = (laid: readonly string[][], font: PdfFont, height: number): void => {
      laid.forEach((cell, index) => {
        const column = columns[index];
        const left = edges[index] ?? MARGIN_X;
        const right = edges[index + 1] ?? MARGIN_X;
        cell.forEach((each, row) => {
          if (each === "") return;
          const x = column?.align === "right" ? right - pad - textWidth(each, font, TABLE.size) : left + pad;
          page().push(textOp(font, TABLE.size, x, y - pad - TABLE.size - row * TABLE.leading, each));
        });
      });
      y -= height;
    };
    const drawHeader = (): void => {
      page().push(fillOp(MARGIN_X, y, CONTENT_WIDTH, headerHeight, GRAY_FILL));
      draw(header, "bold", headerHeight);
      page().push(ruleOp(MARGIN_X, MARGIN_X + CONTENT_WIDTH, y, 0.4));
    };

    const first = rows[0] === undefined ? [] : rowLines(rows[0], bodyFont);
    ensure(headerHeight + (rows[0] === undefined ? 0 : heightOf(first)));
    drawHeader();
    rows.forEach((row, index) => {
      const laid = index === 0 ? first : rowLines(row, bodyFont);
      const height = heightOf(laid);
      if (y - height < BOTTOM) {
        newPage();
        drawHeader();
      }
      draw(laid, bodyFont, height);
      page().push(ruleOp(MARGIN_X, MARGIN_X + CONTENT_WIDTH, y, GRAY_RULE));
    });
    y -= 6;
  }

  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        heading(block.level, block.text);
        break;
      case "paragraph":
        lines("regular", BODY.size, BODY.leading, wrapText(block.text, "regular", BODY.size, CONTENT_WIDTH));
        y -= 6;
        break;
      case "bullets":
        bullets(block.items);
        break;
      case "keyValues":
        keyValues(block.rows);
        break;
      case "table":
        table(block.columns, block.rows, block.mono === true);
        break;
      case "spacer":
        y -= block.height ?? DEFAULT_SPACER;
        break;
      case "pageBreak":
        if (!atTop()) newPage();
        break;
      case "monoLines":
        lines("mono", MONO.size, MONO.leading, hardWrap(block.lines, "mono", MONO.size, CONTENT_WIDTH));
        y -= 6;
        break;
    }
  }
  return pages;
}

/** The footer of page `number` of `count`: a rule, the document's footer text on the left and "Page N of M" on the right. */
export function footerOps(footer: string, number: number, count: number): string[] {
  const label = `Page ${number} of ${count}`;
  const labelWidth = textWidth(label, "regular", FOOTER_SIZE);
  const room = CONTENT_WIDTH - labelWidth - 12;
  return [
    ruleOp(MARGIN_X, MARGIN_X + CONTENT_WIDTH, FOOTER_RULE, GRAY_RULE),
    textOp("regular", FOOTER_SIZE, MARGIN_X, FOOTER_BASELINE, fitText(footer, "regular", FOOTER_SIZE, room), GRAY_TEXT),
    textOp("regular", FOOTER_SIZE, MARGIN_X + CONTENT_WIDTH - labelWidth, FOOTER_BASELINE, label, GRAY_TEXT),
  ];
}
