import { amountsIn } from "./amounts.ts";
import type { DocumentKind, Reading, ReadingContext } from "./reading.ts";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const PRESSURE = /gift ?cards?|bitcoin|crypto|wire transfer|western union|final notice|arrest|legal action|within (?:24|48) hours|do not tell|don't tell|immediately/iu;
const AMOUNT_LINE = /amount due|total due|balance due|please pay|pay this|total/iu;

function dueDay(text: string): string | null {
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/u.exec(text)?.[1];
  if (iso !== undefined && new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso) return iso;
  const named = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "iu").exec(text);
  const swapped = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join("|")}),?\\s+(\\d{4})\\b`, "iu").exec(text);
  const [month, day, year] = named ? [named[1], named[2], named[3]] : swapped ? [swapped[2], swapped[1], swapped[3]] : [];
  if (month === undefined || day === undefined || year === undefined) return null;
  const candidate = `${year}-${String(MONTHS.indexOf(month.toLowerCase()) + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
  return new Date(`${candidate}T00:00:00Z`).toISOString().slice(0, 10) === candidate ? candidate : null;
}

function senderOf(lines: readonly string[]): string | null {
  for (const line of lines) {
    const labelled = /^(?:from|sender|biller|issued by)\s*[:-]\s*(.+)$/iu.exec(line)?.[1];
    if (labelled !== undefined) return labelled.slice(0, 80);
  }
  const [first] = lines;
  return first !== undefined && first.length <= 60 && !/\d/u.test(first) && !/^(dear|re:|subject)/iu.test(first) ? first : null;
}

function kindOf(text: string): DocumentKind {
  if (/receipt|paid in full|thank you for your payment/iu.test(text)) return "receipt";
  if (/invoice|statement|amount due|balance due|please pay|\bbill\b/iu.test(text)) return "bill";
  if (/estimate|\bquote\b/iu.test(text)) return "quote";
  return "letter";
}

/**
 * Reads typed or pasted text with plain rules, for when no model is
 * available. It finds only what is written there: the first labelled
 * amount, an unambiguous date, and a sender line. It never works anything
 * out, and its confidence is the lowest of any reading.
 */
export function readLetterText(text: string, context: Pick<ReadingContext, "currency">): Reading {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== "");
  const labelled = lines.flatMap((line) => (AMOUNT_LINE.test(line) ? amountsIn(line, context.currency) : []));
  const every = amountsIn(text.replaceAll(/\b\d{4}-\d{2}-\d{2}\b|\b\d{4}\b/gu, " "), context.currency);
  const amountCents = labelled[0] ?? (every.length === 1 ? (every[0] ?? null) : null);
  const kind = amountCents === null && kindOf(text) === "bill" ? "letter" : kindOf(text);
  const pressure = PRESSURE.test(text);
  return {
    kind,
    sender: senderOf(lines),
    amountCents,
    dueOn: dueDay(text),
    demandsPayment: (kind === "bill" || pressure) && amountCents !== null,
    pressure,
    confidence: 0.5,
    source: "rules",
  };
}
