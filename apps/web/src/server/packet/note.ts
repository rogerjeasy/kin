import { wordPacketNote } from "@kin/agent";
import type { Provenance } from "@kin/agent/provenance";
import type { BillingAccount } from "@kin/auth";

import type { LookbackView } from "@/content/circle/lookback";
import { createRateLimiter, spendUse, structuredModel } from "@/server/model";

import { englishDay, englishMoney } from "./english";

/** Each person may ask Claude to word the cover note ten times an hour; each server 100 times for demo visitors and 100 for people. */
const noteLimiter = createRateLimiter(10, 60 * 60 * 1000);
const noteBudget = createRateLimiter(100, 60 * 60 * 1000);

export type PacketNote = { readonly text: string; readonly provenance: Provenance; readonly status: "worded" | "fixed" | "unavailable" | "busy" };

/**
 * The cover note to the family's attorney. Plain code works out every figure
 * and writes the fixed note; Claude may put the same facts into warmer
 * sentences, but every number it uses is checked against the record and a
 * mismatch falls back to the fixed note. The note never says the family is
 * safe or compliant: it says what is documented and what is not.
 */
export async function packetNote(
  view: LookbackView,
  context: { readonly currency: string; readonly chainOk: boolean },
  ask: { readonly asked: boolean; readonly userId: string; readonly accountTypes: BillingAccount },
): Promise<PacketNote> {
  const { summary } = view;
  const counted = summary.rows.filter((row) => row.status !== "reversed");
  const lacking = counted.filter((row) => row.status === "needs_documentation");
  const money = (cents: number) => englishMoney(cents, context.currency);
  const figures = [String(counted.length), money(summary.outflowCents), englishDay(summary.from), englishDay(summary.to), money(summary.documentedCents), money(summary.lackingCents), String(lacking.length)];
  const lackingText = lacking.length === 0 ? "No payment is listed as lacking documentation." : `${money(summary.lackingCents)} across ${lacking.length} ${lacking.length === 1 ? "payment is" : "payments are"} listed on the look-back table as lacking documentation.`;
  const statement = [
    `${counted.length} ${counted.length === 1 ? "payment" : "payments"}, ${money(summary.outflowCents)} in all, left the family's care account between ${englishDay(summary.from)} and ${englishDay(summary.to)}.`,
    `${money(summary.documentedCents)} of that is backed by the records in this packet.`,
    lackingText,
    context.chainOk ? "The record's fingerprint check passed when this packet was made." : "The record's fingerprint check did not pass when this packet was made; the packet says which checks failed.",
  ].join(" ");
  const fixed = (status: PacketNote["status"], reason: "not_requested" | "not_configured" | "limit_reached"): PacketNote => ({ text: statement, status, provenance: { source: "template", reason } });
  if (!ask.asked) return fixed("fixed", "not_requested");
  const model = structuredModel();
  if (model === null) return fixed("unavailable", "not_configured");
  if (!spendUse({ limiter: noteLimiter, budget: noteBudget }, ask, Date.now())) return fixed("busy", "limit_reached");
  const worded = await wordPacketNote(model, { figures, statement, language: "English" }, statement);
  return { text: worded.text, provenance: worded.provenance, status: worded.source === "model" ? "worded" : "fixed" };
}
