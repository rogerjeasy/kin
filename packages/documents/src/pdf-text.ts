import { COURIER_WIDTH, FIRST_BYTE, HELVETICA_BOLD_WIDTHS, HELVETICA_WIDTHS } from "./pdf-metrics.ts";

/** The three built-in fonts the writer uses, by the name its pages give them. */
export const FONTS = {
  regular: { resource: "F1", base: "Helvetica" },
  bold: { resource: "F2", base: "Helvetica-Bold" },
  mono: { resource: "F3", base: "Courier" },
} as const;
export type PdfFont = keyof typeof FONTS;

// WinAnsi (Windows-1252) bytes 128 to 159, which hold the typographic characters Latin-1 lacks. 127, 129, 141, 143, 144 and 157 are undefined.
const WIN_ANSI_HIGH = "€\u0000‚ƒ„…†‡ˆ‰Š‹Œ\u0000Ž\u0000\u0000‘’“”•–—˜™š›œ\u0000žŸ";

const BYTE_OF = new Map<string, number>();
for (let byte = FIRST_BYTE; byte <= 126; byte += 1) BYTE_OF.set(String.fromCharCode(byte), byte);
for (let byte = 160; byte <= 255; byte += 1) BYTE_OF.set(String.fromCharCode(byte), byte);
[...WIN_ANSI_HIGH].forEach((char, index) => {
  if (char !== "\u0000") BYTE_OF.set(char, 128 + index);
});

// Characters that look like a WinAnsi one, or are invisible, and are written as the plain equivalent.
const LOOKALIKES = new Map<string, string>([
  ["‐", "-"],
  ["‑", "-"],
  ["‒", "-"],
  ["−", "-"],
  [" ", " "],
  [" ", " "],
  [" ", " "],
  [" ", " "],
  [" ", " "],
  [" ", " "],
  ["　", " "],
  ["\t", "    "],
  ["•", "•"],
  ["­", ""],
  ["​", ""],
  ["‌", ""],
  ["‍", ""],
  ["‎", ""],
  ["‏", ""],
  ["⁠", ""],
  ["﻿", ""],
]);

/**
 * The text as the PDF can show it: every character becomes one WinAnsi glyph
 * or "?". The common typographic characters (curly quotes, en and em dashes,
 * the ellipsis, the bullet, the non-breaking space) are in WinAnsi and stay;
 * thin and other odd spaces become a space, invisible characters vanish, and
 * anything else, such as Cyrillic, Arabic or an emoji, is "?". This is a
 * limitation of the built-in fonts, which carry no outlines for other
 * scripts: the look-back packet is written in English for a US attorney.
 * Line breaks stay as "\n"; every other control character is dropped.
 */
export function sanitizePdfText(text: string): string {
  let out = "";
  for (const char of text.normalize("NFC").replaceAll("\r\n", "\n").replaceAll("\r", "\n")) {
    const plain = LOOKALIKES.get(char);
    if (plain !== undefined) out += plain;
    else if (char === "\n" || BYTE_OF.has(char)) out += char;
    else if (char < " " || (char >= "\u007f" && char < " ")) continue;
    else out += "?";
  }
  return out;
}

/** The width of already sanitized text in 1/1000 of the font size. */
export function textUnits(text: string, font: PdfFont): number {
  if (font === "mono") return [...text].length * COURIER_WIDTH;
  const table = font === "bold" ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let units = 0;
  for (const char of text) units += table[(BYTE_OF.get(char) ?? 63) - FIRST_BYTE] ?? 0;
  return units;
}

/** The width of already sanitized text in points. */
export function textWidth(text: string, font: PdfFont, size: number): number {
  return (textUnits(text, font) * size) / 1000;
}

/** A PDF string literal for sanitized text, in ASCII only: bytes outside the printable range are octal escapes. */
export function pdfString(text: string): string {
  let out = "(";
  for (const char of text) {
    const byte = BYTE_OF.get(char) ?? 63;
    if (char === "\\" || char === "(" || char === ")") out += `\\${char}`;
    else if (byte >= FIRST_BYTE && byte <= 126) out += char;
    else out += `\\${byte.toString(8).padStart(3, "0")}`;
  }
  return `${out})`;
}

/** Breaks a run of characters wherever the next would pass `maxWidth`, always keeping at least one character per piece. */
function breakByCharacter(text: string, font: PdfFont, size: number, maxWidth: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const char of text) {
    if (current !== "" && textWidth(current + char, font, size) > maxWidth) {
      pieces.push(current);
      current = "";
    }
    current += char;
  }
  pieces.push(current);
  return pieces;
}

/** Lines of preformatted text, each broken by character only if it is wider than `maxWidth`. Spaces are kept as written. */
export function hardWrap(lines: readonly string[], font: PdfFont, size: number, maxWidth: number): string[] {
  return lines.flatMap((line) => breakByCharacter(sanitizePdfText(line).replaceAll("\n", " "), font, size, maxWidth));
}

/**
 * Breaks sanitized text into lines no wider than `maxWidth`, at spaces, and
 * inside a word only when the word alone is wider than the line. Each "\n"
 * starts a new line, and a blank line stays blank.
 */
export function wrapText(text: string, font: PdfFont, size: number, maxWidth: number): string[] {
  return sanitizePdfText(text)
    .split("\n")
    .flatMap((paragraph) => {
      const lines: string[] = [];
      let current = "";
      for (const word of paragraph.split(/ +/u).filter((each) => each !== "")) {
        const candidate = current === "" ? word : `${current} ${word}`;
        if (textWidth(candidate, font, size) <= maxWidth) {
          current = candidate;
          continue;
        }
        if (current !== "") lines.push(current);
        const pieces = textWidth(word, font, size) <= maxWidth ? [word] : breakByCharacter(word, font, size, maxWidth);
        lines.push(...pieces.slice(0, -1));
        current = pieces.at(-1) ?? "";
      }
      lines.push(current);
      return lines;
    });
}

/** Sanitized text cut with an ellipsis so it fits `maxWidth`. */
export function fitText(text: string, font: PdfFont, size: number, maxWidth: number): string {
  const clean = sanitizePdfText(text).replaceAll("\n", " ");
  if (textWidth(clean, font, size) <= maxWidth) return clean;
  let cut = [...clean];
  while (cut.length > 0 && textWidth(`${cut.join("")}…`, font, size) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.join("").trimEnd()}…`;
}
