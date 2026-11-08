import { amountSpans } from "./amounts.ts";
import { datesIn } from "./letter-text.ts";

/** A place in a text: the characters from `start` up to, not including, `end`. */
type Span = { readonly start: number; readonly end: number };

const nfc = (text: string) => text.normalize("NFC");
const escapeForRegex = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * Where `quote` is written in `source`, ignoring case, differences in
 * whitespace and the curly or straight form of an apostrophe, or `null` when
 * it is not written there. Both are compared in Unicode NFC, and the span is
 * in that form of `source`. Only the first place is returned.
 */
export function locateQuote(source: string, quote: string): Span | null {
  const words = nfc(quote).trim().split(/\s+/u).filter((word) => word !== "");
  if (words.length === 0) return null;
  const pattern = words.map((word) => escapeForRegex(word).replaceAll(/['‘’]/gu, "['‘’]")).join("\\s+");
  const found = new RegExp(pattern, "iu").exec(nfc(source));
  return found === null ? null : { start: found.index, end: found.index + found[0].length };
}

/** A stretch of the text, and which highlights cover it. `ids` is empty for text nothing quotes. */
export type Segment = { readonly text: string; readonly ids: readonly string[] };
export type Highlight = { readonly id: string; readonly quote: string };

/**
 * Cuts `source` into stretches by which quotes cover them, so a screen can
 * mark the evidence in the original words. A quote that is not written in the
 * source is returned in `missing` and marks nothing; a quote written twice
 * marks its first place; quotes that overlap share the stretch they cover.
 * Joining the segments gives `source` in Unicode NFC.
 */
export function highlightSegments(source: string, highlights: readonly Highlight[]): { readonly segments: Segment[]; readonly missing: string[] } {
  const text = nfc(source);
  const placed = highlights.flatMap((highlight) => {
    const span = locateQuote(text, highlight.quote);
    return span === null ? [] : [{ id: highlight.id, ...span }];
  });
  const missing = highlights.filter((highlight) => !placed.some((each) => each.id === highlight.id)).map((highlight) => highlight.id);
  const cuts = [...new Set([0, text.length, ...placed.flatMap((each) => [each.start, each.end])])].toSorted((a, b) => a - b);
  const segments: Segment[] = [];
  for (const [at, start] of cuts.entries()) {
    const end = cuts[at + 1];
    if (end === undefined) break;
    const ids = [...new Set(placed.filter((each) => each.start <= start && each.end >= end).map((each) => each.id))];
    const last = segments.at(-1);
    if (last !== undefined && last.ids.length === ids.length && last.ids.every((id, index) => id === ids[index])) segments[segments.length - 1] = { text: last.text + text.slice(start, end), ids };
    else segments.push({ text: text.slice(start, end), ids });
  }
  return { segments, missing };
}

export type EvidenceField = "sender" | "amount" | "dueOn";
export type FieldEvidence = { readonly field: EvidenceField; readonly quote: string };

/** The up-to-three words before a place on the same line, so "$73.15" is quoted as "Amount due: $73.15". */
function withLead(text: string, start: number, end: number): string {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lead = [...text.slice(lineStart, start).matchAll(/\S+/gu)];
  const from = lead.at(-3)?.index ?? lead[0]?.index;
  return text.slice(from === undefined ? start : lineStart + from, end);
}

/**
 * The words a document's checked fields were found in, copied from its text.
 * Plain code finds them, whoever read the document, so a reader can see where
 * each amount, sender and date is written. A field the text does not hold in
 * words is left out.
 */
export function fieldEvidence(text: string, reading: { readonly sender: string | null; readonly amountCents: number | null; readonly dueOn: string | null }, currency: string): FieldEvidence[] {
  const source = nfc(text);
  const found: FieldEvidence[] = [];
  const sender = reading.sender === null ? null : locateQuote(source, reading.sender);
  if (sender !== null) found.push({ field: "sender", quote: source.slice(sender.start, sender.end) });
  const amount = reading.amountCents === null ? undefined : amountSpans(source, currency).find((span) => span.cents === reading.amountCents);
  if (amount !== undefined) found.push({ field: "amount", quote: withLead(source, amount.start, amount.end) });
  const due = reading.dueOn === null ? undefined : datesIn(source).find((span) => span.iso === reading.dueOn);
  if (due !== undefined) found.push({ field: "dueOn", quote: withLead(source, due.start, due.end) });
  return found;
}

/** The words of `text` that `quote` points to, as written there, or `null` when it points nowhere. */
export function groundedQuote(text: string, quote: string | null): string | null {
  if (quote === null) return null;
  const source = nfc(text);
  const span = locateQuote(source, quote);
  return span === null ? null : source.slice(span.start, span.end);
}
