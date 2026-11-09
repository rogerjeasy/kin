import { describe, expect, it } from "vitest";

import { PdfDocumentError, renderPdf, type PdfBlock, type PdfDocument } from "./pdf.ts";
import { sanitizePdfText, textWidth, wrapText } from "./pdf-text.ts";
import { hasTool, runOn } from "./testing/external-tools.ts";

const latin1 = (bytes: Uint8Array): string => Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
const created = new Date("2026-11-09T14:30:08Z");
const document = (blocks: PdfBlock[], footer = "Prepared by Kin for the family's attorney"): PdfDocument => ({ title: "Look-back packet", author: "Kin", created, footer, blocks });

const rows = Array.from({ length: 200 }, (_, index) => [`2026-10-${String((index % 28) + 1).padStart(2, "0")}`, `Payout ${index + 1} to a caregiver`, `${index + 1}.00`]);
const table: PdfBlock = {
  type: "table",
  columns: [
    { title: "Date", width: 2, align: "left" },
    { title: "Description", width: 6, align: "left" },
    { title: "Amount", width: 2, align: "right" },
  ],
  rows,
};
const everyBlock: PdfBlock[] = [
  { type: "heading", level: 1, text: "Care pool records" },
  { type: "paragraph", text: "This packet lists what the pool paid. It states no legal conclusion." },
  { type: "heading", level: 2, text: "Summary" },
  { type: "bullets", items: ["Three payouts", "One top-up"] },
  { type: "keyValues", rows: [["Period", "October 1 to November 1, 2026"], ["Total", "$792.00"]] },
  { type: "spacer" },
  table,
  { type: "pageBreak" },
  { type: "monoLines", lines: ["abc  def", "  indented"] },
];

describe("a PDF file", () => {
  const pdf = latin1(renderPdf(document(everyBlock)));

  it("starts as PDF 1.4 and ends with the end-of-file marker", () => {
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.endsWith("%%EOF")).toBe(true);
  });

  it("has startxref pointing at the cross-reference table and an exact offset for every object", () => {
    const start = Number(/startxref\n(\d+)\n%%EOF$/u.exec(pdf)?.[1]);
    expect(pdf.slice(start, start + 5)).toBe("xref\n");
    const header = /^xref\n0 (\d+)\n/u.exec(pdf.slice(start));
    const count = Number(header?.[1]);
    const entries = pdf.slice(start + (header?.[0].length ?? 0)).split("\n").slice(0, count);
    expect(entries[0]).toBe("0000000000 65535 f ");
    entries.slice(1).forEach((entry, index) => {
      expect(entry).toMatch(/^\d{10} 00000 n $/u);
      const offset = Number(entry.slice(0, 10));
      expect(pdf.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });
    expect(/\/Size (\d+)/u.exec(pdf)?.[1]).toBe(String(count));
  });

  it("states a stream length that is the stream's real length", () => {
    for (const match of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/gu)) expect(match[2]?.length).toBe(Number(match[1]));
  });

  it("counts its pages in /Count, in the page objects and in every footer", () => {
    const count = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/u.exec(pdf)?.[1]);
    expect(count).toBeGreaterThan(1);
    expect(pdf.match(/\/Type \/Page /gu)).toHaveLength(count);
    expect(pdf.match(new RegExp(`\\(Page \\d+ of ${count}\\)`, "gu"))).toHaveLength(count);
    expect(pdf).toContain(`(Page 1 of ${count})`);
    expect(pdf).toContain(`(Page ${count} of ${count})`);
  });

  it("names its fonts, with WinAnsi encoding, and writes the Info dictionary with a UTC creation date", () => {
    for (const font of ["Helvetica", "Helvetica-Bold", "Courier"]) expect(pdf).toContain(`/BaseFont /${font} /Encoding /WinAnsiEncoding`);
    expect(pdf).toContain("/Title (Look-back packet) /Author (Kin)");
    expect(pdf).toContain("/CreationDate (D:20261109143008Z)");
    expect(pdf).toContain("/MediaBox [0 0 612 792]");
  });

  it("is the same bytes for the same document", () => {
    expect(renderPdf(document(everyBlock))).toEqual(renderPdf(document(everyBlock)));
  });

  it("writes an empty document as one page", () => {
    expect(latin1(renderPdf(document([])))).toContain("/Count 1");
  });

  it("writes a title with other scripts as UTF-16, so the Info dictionary stays readable", () => {
    expect(latin1(renderPdf({ ...document([]), title: "Dossier – é" }))).toContain("/Title <FEFF0044006F0073007300690065007200202013002000E9>");
  });
});

describe("a long table", () => {
  const pdf = latin1(renderPdf(document([table])));
  const pages = pdf.split(/\/Type \/Page /u).length - 1;

  it("runs over several pages and repeats its header row on each, without losing or repeating a row", () => {
    expect(pages).toBeGreaterThan(3);
    expect(pdf.match(/\(Description\)/gu)).toHaveLength(pages);
    for (const [, description] of rows) expect(pdf.split(`(${description})`).length - 1, description).toBe(1);
  });

  it("keeps every row above the footer, and starts each page with the header", () => {
    for (const stream of pdf.matchAll(/stream\n([\s\S]*?)\nendstream/gu)) {
      const content = stream[1] ?? "";
      const ys = [...content.matchAll(/ (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) Td /gu)].map((match) => Number(match[2])).filter((y) => y !== 36);
      expect(Math.min(...ys)).toBeGreaterThan(60);
      expect(content.indexOf("(Date)")).toBeGreaterThan(-1);
    }
  });

  it("right-aligns a column against its edge", () => {
    const first = /BT \/F1 9 Tf (\d+(?:\.\d+)?) \d+(?:\.\d+)? Td \(1\.00\) Tj/u.exec(pdf);
    const right = 612 - 54 - 4;
    expect(Number(first?.[1]) + textWidth("1.00", "regular", 9)).toBeCloseTo(right, 1);
  });

  it("refuses a table whose rows do not match its columns", () => {
    const bad = { ...table, rows: [["only one"]] } as PdfBlock;
    expect(() => renderPdf(document([bad]))).toThrow(PdfDocumentError);
    expect(() => renderPdf(document([{ type: "table", columns: [], rows: [] }]))).toThrow(PdfDocumentError);
  });

  it("cuts a single row too tall for any page instead of failing", () => {
    const huge = Array.from({ length: 400 }, (_, index) => `line ${index}`).join("\n");
    const out = latin1(renderPdf(document([{ type: "table", columns: [{ title: "Note", width: 1, align: "left" }], rows: [[huge], ["after"]] }])));
    expect(out).toContain("(after)");
    expect(out).toContain("/Count 2");
  });
});

describe("word wrapping", () => {
  const paragraph = "The pool paid each caregiver after the family approved the bill, and every payment is listed with the date PayPal recorded it. ".repeat(6);

  it("keeps every line within the width, using the font's own glyph widths", () => {
    for (const font of ["regular", "bold", "mono"] as const) {
      const lines = wrapText(paragraph, font, 10.5, 504);
      expect(lines.length).toBeGreaterThan(2);
      for (const line of lines) expect(textWidth(line, font, 10.5), line).toBeLessThanOrEqual(504);
      expect(lines.join(" ")).toBe(paragraph.trim());
    }
  });

  it("measures with the AFM widths: a known string in Helvetica and Helvetica-Bold", () => {
    expect(textWidth("Hello", "regular", 10)).toBeCloseTo(((722 + 556 + 222 + 222 + 556) * 10) / 1000, 5);
    expect(textWidth("Hello", "bold", 10)).toBeCloseTo(((722 + 556 + 278 + 278 + 611) * 10) / 1000, 5);
    expect(textWidth("abc", "mono", 10)).toBe(18);
  });

  it("breaks a word wider than the line by character, and keeps blank lines", () => {
    const lines = wrapText(`${"W".repeat(200)}\n\nend`, "regular", 10, 100);
    for (const line of lines) expect(textWidth(line, "regular", 10)).toBeLessThanOrEqual(100);
    expect(lines).toContain("");
    expect(lines.at(-1)).toBe("end");
  });

  it("lays a long paragraph out on the page within the margins", () => {
    const content = latin1(renderPdf(document([{ type: "paragraph", text: paragraph }])));
    const xs = [...content.matchAll(/ Tf (\d+(?:\.\d+)?) \d+(?:\.\d+)? Td /gu)].map((match) => Number(match[1]));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(54);
    expect(Math.max(...xs)).toBeLessThanOrEqual(612 - 54);
  });
});

describe("the text sanitizer", () => {
  it("keeps the typographic characters WinAnsi has", () => {
    expect(sanitizePdfText("“quoted” ‘text’ – — … • ™ € é x")).toBe("“quoted” ‘text’ – — … • ™ € é x");
  });

  it("writes odd spaces as a space, drops invisible characters and controls, and turns a tab into spaces", () => {
    expect(sanitizePdfText("a b c​d﻿e\u0007f\tg")).toBe("a b cdef    g");
    expect(sanitizePdfText("one\r\ntwo\rthree")).toBe("one\ntwo\nthree");
  });

  it("replaces what WinAnsi cannot show with a question mark, one per character", () => {
    expect(sanitizePdfText("Привет 日本 😀")).toBe("?????? ?? ?");
    expect(sanitizePdfText("é")).toBe("é");
  });

  it("writes the bytes WinAnsi assigns: curly quote 0x93, em dash 0x97, bullet 0x95, é 0xE9", () => {
    const out = latin1(renderPdf(document([{ type: "paragraph", text: "“a” — • é (x) \\" }])));
    expect(out).toContain("(\\223a\\224 \\227 \\225 \\351 \\(x\\) \\\\)");
  });
});

describe.skipIf(!hasTool("pdftotext", ["-v"]))("read by pdftotext", () => {
  it("parses, and the text comes back", () => {
    const bytes = renderPdf(document(everyBlock));
    const result = runOn(bytes, "packet.pdf", "pdftotext", (path) => ["-layout", path, "-"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    for (const wanted of ["Care pool records", "Payout 200 to a caregiver", "October 1 to November 1, 2026", "Prepared by Kin for the family's attorney", "$792.00", "Three payouts"]) expect(result.stdout, wanted).toContain(wanted);
    expect(result.stdout).toMatch(/Page 1 of \d+/u);
  });

  it("round-trips typographic characters", () => {
    const result = runOn(renderPdf(document([{ type: "paragraph", text: "“Quoted” – dash … café" }])), "t.pdf", "pdftotext", (path) => [path, "-"]);
    expect(result.stdout).toContain("“Quoted” – dash … café");
  });
});

describe.skipIf(!hasTool("pdfinfo", ["-v"]))("read by pdfinfo", () => {
  it("reports the page count, title, author and date", () => {
    const result = runOn(renderPdf(document(everyBlock)), "packet.pdf", "pdfinfo", (path) => [path]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/Title:\s+Look-back packet/u);
    expect(result.stdout).toMatch(/Author:\s+Kin/u);
    expect(result.stdout).toMatch(/Pages:\s+\d+/u);
    expect(result.stdout).toMatch(/Page size:\s+612 x 792 pts \(letter\)/u);
    expect(result.stdout).toMatch(/CreationDate:.*2026/u);
  });
});
