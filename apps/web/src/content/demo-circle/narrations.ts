import { amountFromSource, dayOfSource } from "./record";

export type NarrationKey = "billPaid" | "refill" | "letter" | "falseDemand" | "caregiverPaid";

export type Narration = {
  readonly key: NarrationKey;
  /** YYYY-MM-DD. */
  readonly day: string;
  /** Every amount Rose hears is read from the ledger entry behind it. */
  readonly cents: number;
};

/**
 * What Kin said to Rose this month, newest first. The amounts come from the
 * record, as the number guard requires (docs/architecture.md section 9.6).
 */
export function roseHeard(): Narration[] {
  return [
    { key: "caregiverPaid", day: dayOfSource("payout-amara"), cents: amountFromSource("payout-amara") },
    { key: "falseDemand", day: "2026-10-15", cents: amountFromSource("payout-gas") },
    { key: "letter", day: "2026-10-12", cents: amountFromSource("bill-water") },
    { key: "refill", day: dayOfSource("capture-refill"), cents: amountFromSource("capture-refill") },
    { key: "billPaid", day: dayOfSource("payout-electricity"), cents: amountFromSource("payout-electricity") },
  ];
}
