import { authorize } from "@kin/auth";
import {
  asPerson,
  readPurse,
  readPursePayees,
  readPursePayments,
  readPurseSpendingAllowed,
  type CircleSnapshot,
  type Database,
  type PursePayeeKind,
  type PursePaymentRecord,
} from "@kin/db";
import { PURSE_CASH, accountBalance, purseReservedCents, sumCents, type PurseHoldReason, type PursePaymentState, type PurseStatus } from "@kin/domain";

import { openPeriod } from "@/content/circle/period";
import { parentNameOf } from "@/content/circle/members";

/**
 * What the Purse's screens read, as the person looking. Row-level security
 * decides which of her payments a person sees: she sees every one, the family
 * only those she shared and those Kin held. Everything else here is read from
 * the ledger every member who sees the money already reads, so a screen can
 * show the family exactly what the database lets them see and no more.
 */

export type PursePaymentView = {
  readonly id: string;
  readonly payeeName: string;
  /** Whether the payee is in her verified address book. */
  readonly payeeInBook: boolean;
  readonly cents: number;
  readonly memo: string | null;
  /** What she said or typed. */
  readonly words: string;
  readonly state: PursePaymentState;
  readonly readBack: string;
  readonly holdReasons: readonly PurseHoldReason[];
  readonly heldAt: string | null;
  readonly holdEndsAt: string | null;
  readonly cancelledByName: string | null;
  readonly pressured: boolean;
  readonly shared: boolean;
  readonly paidAt: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly simulated: boolean;
};

export type PursePayeeView = {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  readonly kind: PursePayeeKind;
  /** The PayPal address with its local part hidden. Only a member checking the entry needs the rest. */
  readonly receiverMasked: string;
  readonly receiver: string;
  readonly verified: boolean;
  readonly addedByName: string;
  readonly verifiedByName: string | null;
  /** Whether the person looking may verify it: someone who answers for the family and did not add it. */
  readonly canVerify: boolean;
};

/** One of the Purse's own lines in the ledger: what every member who sees the money reads. It names nobody. */
export type PurseLedgerLine = { readonly id: string; readonly day: string; readonly cents: number; readonly kind: "purse_funded" | "purse_paid"; readonly simulated: boolean };

export type PurseScreen = {
  readonly purse: {
    readonly weeklyCents: number;
    readonly ceilingCents: number;
    readonly perPaymentCents: number;
    readonly status: PurseStatus;
    readonly setByName: string;
    readonly setAt: string;
    readonly simulated: boolean;
  } | null;
  readonly parentName: string;
  /** Whether the person looking is the parent, whose Purse it is. */
  readonly isParent: boolean;
  /** What the Purse holds by the ledger. */
  readonly balanceCents: number;
  /** What she may still spend, for her eyes only: the balance less what she already said yes to. */
  readonly availableCents: number | null;
  /** This month's money out of the Purse, by the ledger: the total and how many payments. */
  readonly month: { readonly period: string; readonly cents: number; readonly count: number };
  readonly ledgerLines: readonly PurseLedgerLine[];
  readonly payments: readonly PursePaymentView[];
  readonly payees: readonly PursePayeeView[];
  readonly spendingAllowed: boolean;
};

export type PurseReadContext = { readonly db: Database; readonly userId: string; readonly circle: CircleSnapshot };

const MASK = /^(.)[^@]*(@.*)$/u;

/** `lily@personal.example.com` reads `l•••@personal.example.com`. */
export function maskReceiver(address: string): string {
  return address.replace(MASK, "$1•••$2");
}

/** The Purse's own lines in the ledger, newest first, and this month's total out of it. */
export function purseLedger(circle: CircleSnapshot): { readonly lines: PurseLedgerLine[]; readonly month: PurseScreen["month"]; readonly balanceCents: number } {
  const period = openPeriod(circle);
  const entries = circle.ledger.entries.filter((entry): entry is typeof entry & { kind: "purse_funded" | "purse_paid" } => entry.kind === "purse_funded" || entry.kind === "purse_paid").toReversed();
  const lines = entries.map((entry) => ({ id: entry.id, day: entry.occurredOn, cents: entry.lines.find((line) => line.account === PURSE_CASH)?.cents ?? 0, kind: entry.kind, simulated: entry.simulated }));
  const paid = lines.filter((line, index) => line.kind === "purse_paid" && entries[index]?.period === period);
  return {
    lines,
    month: { period, cents: sumCents(paid.map((line) => line.cents)), count: paid.length },
    balanceCents: accountBalance(circle.ledger, PURSE_CASH),
  };
}

export function paymentView(record: PursePaymentRecord, nameOf: (memberId: string) => string): PursePaymentView {
  return {
    id: record.id,
    payeeName: record.payeeName,
    payeeInBook: record.payeeId !== null,
    cents: record.cents,
    memo: record.memo,
    words: record.words,
    state: record.state,
    readBack: record.readBack,
    holdReasons: record.holdReasons,
    heldAt: record.heldAt?.toISOString() ?? null,
    holdEndsAt: record.holdEndsAt?.toISOString() ?? null,
    cancelledByName: record.cancelledBy === null ? null : nameOf(record.cancelledBy),
    pressured: record.pressured,
    shared: record.sharedAt !== null,
    paidAt: record.paidAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    simulated: record.simulated,
  };
}

/** Everything the Purse's screens show, or `null` for a role that may not see it. */
export async function purseScreen(context: PurseReadContext): Promise<PurseScreen | null> {
  const { circle } = context;
  const seat = { role: circle.viewer.role, status: "active" as const };
  if (!authorize(seat, "purse.view").allowed) return null;
  const circleId = circle.circle.id;
  const names = new Map(circle.members.map((member) => [member.id, member.displayName]));
  const nameOf = (memberId: string) => names.get(memberId) ?? "";
  const { purse, payees, payments, spendingAllowed } = await asPerson(context.db, context.userId, async (tx) => ({
    purse: await readPurse(tx, circleId),
    payees: await readPursePayees(tx, circleId),
    payments: await readPursePayments(tx, circleId),
    spendingAllowed: await readPurseSpendingAllowed(tx, circleId),
  }));
  const ledger = purseLedger(circle);
  const isParent = circle.viewer.role === "parent";
  const mayVerify = authorize(seat, "purse_payee.verify").allowed;
  return {
    purse: purse === null ? null : { weeklyCents: purse.weeklyCents, ceilingCents: purse.ceilingCents, perPaymentCents: purse.perPaymentCents, status: purse.status, setByName: nameOf(purse.setBy), setAt: purse.setAt.toISOString(), simulated: purse.simulated },
    parentName: parentNameOf(circle),
    isParent,
    balanceCents: ledger.balanceCents,
    // Only she sees every payment, so only for her is the sum of what she already said yes to known.
    availableCents: isParent ? Math.max(0, ledger.balanceCents - purseReservedCents(payments.map((payment) => ({ state: payment.state, cents: payment.cents, payeeVerified: payment.payeeId !== null })))) : null,
    month: ledger.month,
    ledgerLines: ledger.lines,
    payments: payments.map((payment) => paymentView(payment, nameOf)),
    payees: payees.map((payee) => ({
      id: payee.id,
      name: payee.name,
      relationship: payee.relationship,
      kind: payee.kind,
      receiverMasked: maskReceiver(payee.paypalReceiver),
      receiver: mayVerify && payee.verifiedAt === null ? payee.paypalReceiver : maskReceiver(payee.paypalReceiver),
      verified: payee.verifiedAt !== null,
      addedByName: nameOf(payee.addedBy),
      verifiedByName: payee.verifiedBy === null ? null : nameOf(payee.verifiedBy),
      canVerify: mayVerify && payee.verifiedAt === null && payee.addedBy !== circle.viewer.memberId,
    })),
    spendingAllowed,
  };
}
