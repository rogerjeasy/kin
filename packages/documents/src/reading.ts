import type { RawReading } from "@kin/agent";
import { centsFromDecimal } from "@kin/domain";

import { MAX_DOCUMENT_CENTS, amountsIn } from "./amounts.ts";

export type DocumentKind = RawReading["kind"];

/** How a reading was made, so Kin never claims more certainty than it has. */
export type ReadingSource = "model_text" | "model_photo" | "rules";

/** What a document says, after every field was checked. Safe to store and to speak from. */
export type Reading = {
  readonly kind: DocumentKind;
  readonly sender: string | null;
  readonly amountCents: number | null;
  /** YYYY-MM-DD. */
  readonly dueOn: string | null;
  readonly demandsPayment: boolean;
  /** Hurries, threatens, or asks for gift cards, cash or secret codes. */
  readonly pressure: boolean;
  readonly confidence: number;
  readonly source: ReadingSource;
};

export type ReadingContext = {
  /** The document's own words, when there are some to check the answer against. Absent for a photograph. */
  readonly text: string | null;
  readonly currency: string;
  /** The circle's today, as YYYY-MM-DD. */
  readonly today: string;
};

const MAX_SENDER_LENGTH = 80;
const DAY_MS = 86_400_000;
const normalize = (text: string) => text.normalize("NFC").toLowerCase().replace(/[‘’]/gu, "'").replace(/\s+/gu, " ").trim();

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** A due date a household bill could have: not long past, not years away. */
function plausibleDue(value: string, today: string): boolean {
  const gap = (Date.parse(`${value}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS;
  return gap >= -90 && gap <= 400;
}

/**
 * Checks what the model said a document holds. Nothing in it is trusted:
 * the amount must be a real decimal and, when the document's words are
 * known, must appear in them; the sender likewise. A field that fails is
 * dropped to `null`, never repaired, so a person reads what the document
 * says or is told Kin could not tell.
 */
export function settleReading(raw: RawReading, context: ReadingContext): Reading {
  const words = context.text === null ? null : normalize(context.text);
  const sender = checkedSender(raw.sender, words);
  const amountCents = checkedAmount(raw.amount, context);
  const dueOn = raw.dueOn !== null && isDay(raw.dueOn) && plausibleDue(raw.dueOn, context.today) ? raw.dueOn : null;
  // A bill with no amount to pay is only a letter.
  const kind = raw.kind === "bill" && amountCents === null ? "letter" : raw.kind;
  const traced = sender !== null && amountCents !== null;
  const confidence = words === null ? (traced ? 0.7 : 0.4) : traced ? 0.9 : 0.6;
  return { kind, sender, amountCents, dueOn, demandsPayment: raw.demandsPayment, pressure: raw.pressure, confidence, source: words === null ? "model_photo" : "model_text" };
}

const KINDS: readonly string[] = ["bill", "receipt", "quote", "letter", "other"];
const SOURCES: readonly string[] = ["model_text", "model_photo", "rules"];

/**
 * Reads back a reading stored with a document. What is stored is JSON the
 * database holds, so it is parsed again before anyone speaks from it; a row
 * that does not look like a reading gives `null`.
 */
export function parseStoredReading(value: unknown): Reading | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const text = (field: unknown) => (typeof field === "string" ? field : null);
  const cents = row.amountCents;
  if (
    typeof row.kind !== "string" || !KINDS.includes(row.kind) ||
    typeof row.source !== "string" || !SOURCES.includes(row.source) ||
    typeof row.demandsPayment !== "boolean" || typeof row.pressure !== "boolean" ||
    typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1 ||
    (cents !== null && !(typeof cents === "number" && Number.isSafeInteger(cents) && cents > 0))
  ) {
    return null;
  }
  const dueOn = text(row.dueOn);
  return {
    kind: row.kind as DocumentKind,
    sender: text(row.sender),
    amountCents: cents as number | null,
    dueOn: dueOn !== null && isDay(dueOn) ? dueOn : null,
    demandsPayment: row.demandsPayment,
    pressure: row.pressure,
    confidence: row.confidence,
    source: row.source as ReadingSource,
  };
}

function checkedSender(sender: string | null, words: string | null): string | null {
  const name = sender?.replace(/\s+/gu, " ").trim() ?? "";
  if (name === "" || name.length > MAX_SENDER_LENGTH) return null;
  return words !== null && !words.includes(normalize(name)) ? null : name;
}

function checkedAmount(amount: string | null, context: ReadingContext): number | null {
  if (amount === null) return null;
  let cents: number;
  try {
    cents = centsFromDecimal(amount.trim(), context.currency);
  } catch {
    return null;
  }
  if (cents <= 0 || cents > MAX_DOCUMENT_CENTS) return null;
  return context.text !== null && !amountsIn(context.text, context.currency).includes(cents) ? null : cents;
}
