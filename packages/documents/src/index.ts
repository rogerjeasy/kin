export { MAX_DOCUMENT_CENTS, amountsIn } from "./amounts.ts";
export { readLetterText } from "./letter-text.ts";
export { parseStoredReading, settleReading } from "./reading.ts";
export type { DocumentKind, Reading, ReadingContext, ReadingSource } from "./reading.ts";

/** A reading that needs a person to act: a bill to pay, from someone Kin can name, without pressure. */
export function needsAction(reading: { readonly kind: string; readonly sender: string | null; readonly amountCents: number | null; readonly pressure: boolean }): boolean {
  return reading.kind === "bill" && reading.sender !== null && reading.amountCents !== null && !reading.pressure;
}
