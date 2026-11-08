import type { CircleSnapshot } from "@kin/db";
import { confirmedPayments, type RecordFacts } from "@kin/domain";

/** What a demand for money, by letter or by phone, is checked against: the payees, bills and confirmed payments on record. */
export function claimRecord(circle: CircleSnapshot): RecordFacts {
  return {
    payees: circle.payees.map((each) => ({ id: each.id, name: each.name })),
    bills: circle.bills.map((bill) => ({ payeeId: bill.payeeId, cents: bill.amountCents, state: bill.state })),
    payments: confirmedPayments(circle.ledger.entries),
  };
}
