import type { CircleSnapshot } from "@kin/db";
import { leftThePool, type PayPalPool } from "@kin/paypal";

import type { LookbackView } from "@/content/circle/lookback";
import { circleToday } from "@/content/circle/today";
import { topUpServices } from "@/server/paypal";

import type { PaymentProof } from "./proofs";

/** PayPal reads for one packet, at most: a packet cannot fan out across PayPal, and a family rarely has more real payments than this a year. */
const DAY_MS = 86_400_000;

/**
 * PayPal says Transaction Search can take up to three hours to list a new
 * transaction. Kin keeps only the day a payment was made, so one made today or
 * yesterday on the circle's calendar that is not listed is "not yet listed",
 * not "not found".
 */
function unlisted(paidOn: string, today: string): "not_yet_listed" | "not_found" {
  return Date.parse(`${today}T00:00:00Z`) - Date.parse(`${paidOn}T00:00:00Z`) <= DAY_MS ? "not_yet_listed" : "not_found";
}

const MAX_READS = 40;
const IN_PARALLEL = 4;

/**
 * What PayPal's own Transaction Search says about each payment in the
 * look-back. The payout item to read always comes from Kin's own execution
 * record, never from a request. A simulated payment has no PayPal transaction
 * and says so; a payment PayPal could not be read for says "unread" rather
 * than guessing, and one too new for PayPal to list says so. Nothing here
 * writes to PayPal.
 */
export async function paymentProofs(circle: CircleSnapshot, view: LookbackView, pool: PayPalPool | null = topUpServices()?.pool ?? null): Promise<PaymentProof[]> {
  const entries = new Map(circle.ledger.entries.map((entry) => [entry.id, entry]));
  const today = circleToday(circle);
  const proofs: PaymentProof[] = [];
  let reads = 0;
  const pending: (() => Promise<void>)[] = [];
  for (const row of view.summary.rows) {
    const entry = entries.get(row.entryId);
    const itemId = view.itemOf.get(row.entryId) ?? null;
    const none = { entryId: row.entryId, itemId, transactionId: null, status: null, amountCents: null, currency: null, at: null, leftThePool: null, counterparty: null } as const;
    if (entry === undefined || entry.simulated) {
      proofs.push({ ...none, source: "simulated" });
      continue;
    }
    if (pool === null || itemId === null || reads >= MAX_READS) {
      proofs.push({ ...none, source: "unread" });
      continue;
    }
    reads += 1;
    const slot = proofs.push({ ...none, source: "unread" }) - 1;
    pending.push(async () => {
      try {
        const record = await pool.getPayoutTransaction(itemId, new Date(`${entry.occurredOn}T12:00:00Z`));
        proofs[slot] =
          record === null
            ? { ...none, source: unlisted(entry.occurredOn, today) }
            : { ...none, source: "paypal", transactionId: record.transactionId, status: record.status, amountCents: record.amountCents, currency: record.currency, at: record.initiatedAt, leftThePool: leftThePool(record), counterparty: record.counterpartyEmailMasked };
      } catch {
        // PayPal refused or could not be reached: the packet says "unread", and the family can download again later.
      }
    });
  }
  for (let start = 0; start < pending.length; start += IN_PARALLEL) await Promise.all(pending.slice(start, start + IN_PARALLEL).map((read) => read()));
  return proofs;
}
