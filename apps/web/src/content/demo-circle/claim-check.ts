import { amountFromSource, dayOfSource } from "./record";

/**
 * The false demand of day 15 (docs/project-description.md section 5): what the
 * caller claimed, and the real record Kin checked it against. The verdict is
 * plain code's, made when the check ran. The amounts paid come from the ledger.
 */
export const falseDemand = {
  day: "2026-10-15",
  claimedCents: 30000,
  payeeId: "gas",
  verdict: "no_match",
  lastPaid: { cents: amountFromSource("payout-gas"), day: dayOfSource("payout-gas") },
  alerted: ["elena", "marcus"],
} as const;
