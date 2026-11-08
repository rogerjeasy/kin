import type { Agreement } from "../agreement.ts";
import type { EntryHeader, EntrySource, LedgerEntry } from "../ledger-entry.ts";
import { appendEntries, openLedger, type Ledger } from "../ledger.ts";
import type { SettlementQuery } from "../settle-period.ts";
import {
  billApproved,
  careCreditLogged,
  contributionReceived,
  outOfPocketApproved,
  payoutConfirmed,
  purchaseCaptured,
} from "../postings.ts";

/**
 * Rose's month, from docs/project-description.md section 5, as ledger entries.
 * It is example data: every entry is marked simulated and no PayPal
 * transaction stands behind it.
 *
 * The story fixes the shares, the bills, Elena's 180.00 of pharmacy receipts
 * and Ana's four appointments. It does not say what each sibling paid in or
 * what an hour of care is worth. Those are chosen here so that the settlement
 * the story tells follows from the calculation: care at 20.00 an hour, and
 * Marcus paying in 424.00, which is 76.00 short of half the month's cash.
 * The stairlift repair of day 20 is booked and not yet paid, so it is absent.
 * Each bill paid by payout carries PayPal's payout fee, as the sandbox charged.
 */

/**
 * What Rose's blood pressure refill costs. The marketing pages, the demo
 * circle's purchase rule and its November bill all read this one figure. It is
 * above what Rose decides alone, which is why the refill waits for her yes or
 * her standing permission.
 */
export const REFILL_PRICE_CENTS = 6400;

const CIRCLE_ID = "rose";
const CURRENCY = "USD";
const PERIOD = "2026-10";
const CARE_RATE_CENTS_PER_HOUR = 2000;
// What PayPal's sandbox charged to send a payout on 14 October 2026. Real
// fees are read back from each payout, never assumed.
const PAYOUT_FEE_CENTS = 25;

const agreement: Agreement = {
  version: 1,
  shares: [
    { memberId: "marcus", bps: 5000 },
    { memberId: "elena", bps: 3000 },
    { memberId: "ana", bps: 2000 },
  ],
  care: { rateCentsPerHour: CARE_RATE_CENTS_PER_HOUR, paidInCash: false },
  // Rose decides above 50.00, as the story's pharmacy refill shows. The
  // ceiling and the second-approval threshold are chosen for the example.
  approvals: {
    ceilingCents: 300000,
    secondApprovalAboveCents: 50000,
    parentDecidesAboveCents: 5000,
  },
};

function header(
  day: number,
  source: EntrySource,
  description: string,
): EntryHeader {
  return {
    id: `${source.type}:${source.id}`,
    circleId: CIRCLE_ID,
    occurredOn: `${PERIOD}-${String(day).padStart(2, "0")}`,
    period: PERIOD,
    description,
    source,
    currency: CURRENCY,
    simulated: true,
  };
}

const paypal = (id: string): EntrySource => ({ type: "paypal_event", id });
const approval = (id: string): EntrySource => ({ type: "approval", id });

/** A bill that is approved and then confirmed paid by PayPal. */
function billPaid(
  approvedOn: number,
  paidOn: number,
  bill: { payeeId: string; category: string; cents: number; name: string },
): LedgerEntry[] {
  return [
    billApproved(
      header(approvedOn, approval(`bill-${bill.payeeId}`), `${bill.name} approved`),
      bill,
    ),
    payoutConfirmed(
      header(paidOn, paypal(`payout-${bill.payeeId}`), `${bill.name} paid`),
      { ...bill, feeCents: PAYOUT_FEE_CENTS },
    ),
  ];
}

function pharmacyReceipt(day: number, cents: number): LedgerEntry {
  return outOfPocketApproved(
    header(day, approval(`receipt-elena-${day}`), "Elena's pharmacy receipt"),
    { memberId: "elena", category: "pharmacy", cents },
  );
}

function appointment(day: number, minutes: number): LedgerEntry {
  return careCreditLogged(
    header(day, approval(`care-ana-${day}`), "Ana drove Rose to an appointment"),
    { memberId: "ana", minutes, rateCentsPerHour: CARE_RATE_CENTS_PER_HOUR },
  );
}

const entries: LedgerEntry[] = [
  contributionReceived(
    header(1, paypal("sale-marcus"), "Marcus's monthly contribution"),
    { memberId: "marcus", grossCents: 42400, feeCents: 1487 },
  ),
  contributionReceived(
    header(1, paypal("sale-elena"), "Elena's monthly contribution"),
    { memberId: "elena", grossCents: 30000, feeCents: 1067 },
  ),
  contributionReceived(
    header(1, paypal("sale-ana"), "Ana's monthly contribution"),
    { memberId: "ana", grossCents: 20000, feeCents: 728 },
  ),
  ...billPaid(2, 2, {
    payeeId: "gas",
    category: "utilities",
    cents: 5700,
    name: "Gas bill",
  }),
  ...billPaid(3, 3, {
    payeeId: "electricity",
    category: "utilities",
    cents: 8400,
    name: "Electricity bill",
  }),
  appointment(5, 45),
  ...billPaid(6, 6, {
    payeeId: "amara",
    category: "care",
    cents: 26400,
    name: "Amara's twelve hours",
  }),
  pharmacyReceipt(8, 7200),
  purchaseCaptured(
    header(9, paypal("capture-refill"), "Blood pressure refill"),
    { category: "pharmacy", cents: REFILL_PRICE_CENTS },
  ),
  ...billPaid(12, 30, {
    payeeId: "water",
    category: "utilities",
    cents: 6100,
    name: "Water bill",
  }),
  appointment(13, 75),
  pharmacyReceipt(17, 5850),
  appointment(21, 48),
  pharmacyReceipt(26, 4950),
  appointment(28, 60),
];

const ledger: Ledger = appendEntries(openLedger(CIRCLE_ID, CURRENCY), entries);

/** Everything needed to settle Rose's month. */
export const rosesMonth = {
  ledger,
  agreement,
  period: PERIOD,
  payoutFee: () => PAYOUT_FEE_CENTS,
} as const satisfies SettlementQuery;
