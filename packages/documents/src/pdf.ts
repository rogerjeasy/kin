import { FONTS } from "./pdf-text.ts";
import { PAGE_HEIGHT, PAGE_WIDTH, footerOps, layoutBlocks } from "./pdf-layout.ts";
import type { PdfDocument } from "./pdf-types.ts";

export { PdfDocumentError } from "./pdf-types.ts";
export type { PdfBlock, PdfDocument, PdfTableColumn } from "./pdf-types.ts";
export { sanitizePdfText } from "./pdf-text.ts";

// Object numbers are fixed: the catalog, the page tree, three fonts and the Info dictionary come first, then a page and its content stream for each page.
const CATALOG = 1;
const PAGE_TREE = 2;
const FIRST_FONT = 3;
const INFO = 6;
const FIRST_PAGE = 7;

const pad = (value: number | string, digits: number): string => String(value).padStart(digits, "0");

/** `D:YYYYMMDDHHmmSSZ`, in UTC. */
function pdfDate(date: Date): string {
  return `D:${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCDate(), 2)}${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}${pad(date.getUTCSeconds(), 2)}Z`;
}

/** A text string for the Info dictionary: a plain literal when it is printable ASCII, else UTF-16BE with a byte order mark. */
function infoString(text: string): string {
  if (/^[\x20-\x7e]*$/u.test(text)) return `(${text.replaceAll(/[\\()]/gu, (char) => `\\${char}`)})`;
  let hex = "FEFF";
  for (let index = 0; index < text.length; index += 1) hex += pad(text.charCodeAt(index).toString(16).toUpperCase(), 4);
  return `<${hex}>`;
}

/**
 * Writes a PDF 1.4 file with US Letter pages, the built-in Helvetica,
 * Helvetica-Bold and Courier fonts in WinAnsi encoding, and no other
 * dependency. Text outside WinAnsi is shown as "?" (see `sanitizePdfText`).
 * The output depends only on the document, so the same document is always the
 * same bytes.
 */
export function renderPdf(doc: PdfDocument): Uint8Array {
  const pages = layoutBlocks(doc.blocks);
  const objects: string[] = [];
  const pageObject = (index: number): number => FIRST_PAGE + 2 * index;
  const fontEntries = Object.values(FONTS).map((font, index) => `/${font.resource} ${FIRST_FONT + index} 0 R`).join(" ");

  objects[CATALOG] = `<< /Type /Catalog /Pages ${PAGE_TREE} 0 R >>`;
  objects[PAGE_TREE] = `<< /Type /Pages /Kids [${pages.map((_, index) => `${pageObject(index)} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  Object.values(FONTS).forEach((font, index) => {
    objects[FIRST_FONT + index] = `<< /Type /Font /Subtype /Type1 /BaseFont /${font.base} /Encoding /WinAnsiEncoding >>`;
  });
  objects[INFO] = `<< /Title ${infoString(doc.title)} /Author ${infoString(doc.author)} /Producer (Kin) /CreationDate (${pdfDate(doc.created)}) >>`;
  pages.forEach((ops, index) => {
    const content = [...ops, ...footerOps(doc.footer, index + 1, pages.length)].join("\n");
    objects[pageObject(index)] = `<< /Type /Page /Parent ${PAGE_TREE} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << ${fontEntries} >> >> /Contents ${pageObject(index) + 1} 0 R >>`;
    // The content is ASCII (see pdfString), so its length in characters is its length in bytes.
    objects[pageObject(index) + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  // The comment's four high bytes tell transfer tools the file is binary; they are written as Latin-1 below.
  let file = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  for (let number = 1; number < objects.length; number += 1) {
    offsets[number] = file.length;
    file += `${number} 0 obj\n${objects[number]}\nendobj\n`;
  }
  const xref = file.length;
  file += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let number = 1; number < objects.length; number += 1) file += `${pad(offsets[number] ?? 0, 10)} 00000 n \n`;
  file += `trailer\n<< /Size ${objects.length} /Root ${CATALOG} 0 R /Info ${INFO} 0 R >>\nstartxref\n${xref}\n%%EOF`;

  // Every character is below 256, so one character is one byte.
  const bytes = new Uint8Array(file.length);
  for (let index = 0; index < file.length; index += 1) bytes[index] = file.charCodeAt(index);
  return bytes;
}
