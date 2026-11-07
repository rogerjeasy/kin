import type { CircleSnapshot } from "@kin/db";
import { entryHeadline, type RecordFacts } from "@kin/domain";

/** What a demand for money, by letter or by phone, is checked against: the payees, bills and confirmed payments on record. */
export function claimRecord(circle: CircleSnapshot): RecordFacts {
  return {
    payees: circle.payees.map((each) => ({ id: each.id, name: each.name })),
    bills: circle.bills.map((bill) => ({ payeeId: bill.payeeId, cents: bill.amountCents, state: bill.state })),
    payments: circle.ledger.entries.flatMap((entry) => {
      if (entry.kind !== "payout_confirmed") return [];
      const headline = entryHeadline(entry);
      return [{ entryId: entry.id, payeeId: headline.subject, cents: headline.cents, day: entry.occurredOn }];
    }),
  };
}
