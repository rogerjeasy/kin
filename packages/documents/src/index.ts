export { MAX_DOCUMENT_CENTS, amountsIn } from "./amounts.ts";
export { fieldEvidence, groundedQuote, highlightSegments, locateQuote } from "./evidence.ts";
export type { EvidenceField, FieldEvidence, Highlight, Segment } from "./evidence.ts";
export { readLetterText } from "./letter-text.ts";
export { readableName } from "./readable-name.ts";
export { parseStoredReading, settleReading } from "./reading.ts";
export type { DocumentKind, Reading, ReadingContext, ReadingSource } from "./reading.ts";

/** A reading that needs a person to act: a bill to pay, from someone Kin can name, without pressure. */
export function needsAction(reading: { readonly kind: string; readonly sender: string | null; readonly amountCents: number | null; readonly pressure: boolean }): boolean {
  return reading.kind === "bill" && reading.sender !== null && reading.amountCents !== null && !reading.pressure;
}
