import { calculateCaregiverBill, calendarDay, type CircleRole, type Payee, type ReceiptCategory } from "@kin/domain";
import { and, asc, desc, eq, ne } from "drizzle-orm";

import type {
  CircleRecord,
  CircleSnapshot,
  MemberRecord,
  MonthlyShareRecord,
  PayeeRecord,
  ProposalRecord,
  ReceiptRecord,
} from "./circle-snapshot.ts";
import type { Transaction } from "./connection.ts";
import { readAgreementVersions } from "./agreements.ts";
import { readLedger } from "./ledger-store.ts";
import { parseApprovalPlan } from "./plan-json.ts";
import { readPurchaseRecords } from "./purchases.ts";
import {
  approvals,
  bills,
  careEntries,
  circles,
  claimChecks,
  documents,
  expectedBills,
  invitations,
  members,
  monthlyShares,
  narrations,
  payees,
  proposals,
  receipts,
  settlements,
} from "./schema/index.ts";

/** No circle the person may open has this ID. Retrying cannot help. */
export class CircleNotFoundError extends Error {
  readonly retryable = false;

  constructor(circleId: string) {
    super(`No circle ${circleId} is open to this person`);
    this.name = "CircleNotFoundError";
  }
}

/**
 * Reads a circle as the person in `tx` sees it. Call it inside `asPerson`:
 * row-level security decides what comes back, and a circle the person is not
 * an active member of reads as not found.
 */
export async function readCircle(tx: Transaction, query: { circleId: string; userId: string; now: Date }): Promise<CircleSnapshot> {
  const circle = await readCircleRow(tx, query.circleId, query.now);
  const memberRows = await tx.select().from(members).where(eq(members.circleId, circle.id)).orderBy(asc(members.joinedAt), asc(members.id));
  const viewerRow = memberRows.find((row) => row.userId === query.userId && row.status === "active");
  if (!viewerRow) throw new CircleNotFoundError(query.circleId);

  const roster: MemberRecord[] = memberRows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    role: row.role,
    parentLevel: row.parentLevel,
    relationship: row.relationship,
    portrait: row.portrait,
    currency: row.currency,
    status: row.status,
    joinedAt: row.joinedAt,
  }));
  const roleOf = (memberId: string): CircleRole => {
    const member = roster.find((each) => each.id === memberId);
    if (!member) throw new Error(`Member ${memberId} is not in circle ${circle.id}`);
    return member.role;
  };

  return {
    circle,
    viewer: { memberId: viewerRow.id, role: viewerRow.role },
    members: roster,
    ...(await readAgreements(tx, circle)),
    payees: await readPayees(tx, circle.id, roleOf),
    settlementReceivers: await readSettlementReceivers(tx, circle.id),
    ledger: await readLedger(tx, circle),
    // After the ledger, whose entries it references: tables are locked in one order, so a
    // truncate that cascades from the ledger cannot deadlock with a read of the circle.
    receipts: await readReceipts(tx, circle.id),
    proposals: await readProposals(tx, circle.id),
    bills: await readBills(tx, circle.id),
    expectedBills: await readExpectedBills(tx, circle.id),
    careEntries: await readCare(tx, circle.id),
    settlements: await readSettlements(tx, circle.id),
    claimChecks: await readClaimChecks(tx, circle.id),
    narrations: await readNarrations(tx, circle.id),
    ...(await readPurchaseRecords(tx, circle.id, circle.now, circle.timezone)),
    documents: await readDocuments(tx, circle.id),
    invitations: await readInvitations(tx, circle.id),
    monthlyShares: await readMonthlyShares(tx, circle.id, viewerRow.id),
  };
}

async function readCircleRow(tx: Transaction, circleId: string, now: Date): Promise<CircleRecord> {
  const [row] = await tx.select().from(circles).where(and(eq(circles.id, circleId), eq(circles.status, "active")));
  if (!row) throw new CircleNotFoundError(circleId);
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    currency: row.currency,
    demo: row.demo,
    now: row.clockAt ?? now,
    pausedUntil: row.pausedUntil,
    pausedBy: row.pausedBy,
  };
}

/** The version in force, and every version, as the agreement's own rule decides between them. */
async function readAgreements(tx: Transaction, circle: CircleRecord): Promise<Pick<CircleSnapshot, "agreement" | "agreementVersions">> {
  const { versions } = await readAgreementVersions(tx, circle.id, calendarDay(circle.now, circle.timezone).occurredOn);
  const inForce = versions.find((version) => version.status === "in_force");
  return {
    agreement: inForce ? { id: inForce.id, version: inForce.version, effectiveOn: inForce.effectiveOn, shares: inForce.shares, care: inForce.care, approvals: inForce.approvals, acceptances: inForce.acceptances } : null,
    agreementVersions: versions,
  };
}

async function readPayees(tx: Transaction, circleId: string, roleOf: (memberId: string) => CircleRole): Promise<PayeeRecord[]> {
  // A member's settlement address is a payee row of its own category, shown on its own (see readSettlementReceivers).
  const rows = await tx.select().from(payees).where(and(eq(payees.circleId, circleId), ne(payees.category, "settlement"))).orderBy(asc(payees.createdAt), asc(payees.name));
  return rows.map((row) => {
    const autoPay: Payee["autoPay"] =
      row.autoPayRuleId !== null && row.autoPayMinCents !== null && row.autoPayMaxCents !== null
        ? { ruleId: row.autoPayRuleId, minCents: row.autoPayMinCents, maxCents: row.autoPayMaxCents }
        : null;
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      caregiverRateCentsPerHour: row.caregiverRateCentsPerHour,
      receiver: maskEmail(row.paypalReceiver),
      payee: {
        status: row.status,
        member: row.memberId === null ? null : { memberId: row.memberId, role: roleOf(row.memberId) },
        autoPay,
      },
    };
  });
}

async function readReceipts(tx: Transaction, circleId: string): Promise<ReceiptRecord[]> {
  const rows = await tx.select().from(receipts).where(eq(receipts.circleId, circleId)).orderBy(asc(receipts.createdAt), asc(receipts.id));
  return rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    // Safe: a check constraint holds the category to the domain's own list.
    category: row.category as ReceiptCategory,
    cents: row.cents,
    description: row.description,
    spentOn: row.spentOn,
    state: row.state,
    decidedBy: row.decidedBy,
    entryId: row.entryId,
  }));
}

async function readSettlementReceivers(tx: Transaction, circleId: string): Promise<{ memberId: string; receiver: string }[]> {
  const rows = await tx.select({ memberId: payees.memberId, receiver: payees.paypalReceiver }).from(payees).where(and(eq(payees.circleId, circleId), eq(payees.category, "settlement")));
  return rows.flatMap((row) => (row.memberId === null || row.receiver === null ? [] : [{ memberId: row.memberId, receiver: maskEmail(row.receiver) ?? "••••" }]));
}

/** `amara@example.com` reads as `a••••@example.com`. */
function maskEmail(email: string | null): string | null {
  if (email === null) return null;
  const at = email.lastIndexOf("@");
  return at < 1 ? "••••" : `${email.slice(0, 1)}••••${email.slice(at)}`;
}

async function readProposals(tx: Transaction, circleId: string): Promise<ProposalRecord[]> {
  const rows = await tx.select().from(proposals).where(eq(proposals.circleId, circleId)).orderBy(asc(proposals.raisedAt), asc(proposals.id));
  const votes = await tx.select().from(approvals).where(eq(approvals.circleId, circleId)).orderBy(asc(approvals.decidedAt));
  const votesOf = Map.groupBy(votes, (vote) => vote.proposalId);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    cents: row.cents,
    to: recipientOf(row),
    purpose: row.purpose,
    note: row.note,
    raisedBy: row.raisedBy,
    raisedAt: row.raisedAt,
    state: row.state,
    expiresAt: row.expiresAt,
    agreementVersion: row.agreementVersion,
    plan: parseApprovalPlan(row.plan),
    billId: row.billId,
    settlementId: row.settlementId,
    documentId: row.documentId,
    votes: (votesOf.get(row.id) ?? []).map((vote) => ({
      memberId: vote.memberId,
      role: vote.role,
      decision: vote.decision,
      method: vote.method,
      at: vote.decidedAt,
    })),
  }));
}

function recipientOf(row: { id: string; payeeId: string | null; memberId: string | null }): ProposalRecord["to"] {
  if (row.payeeId !== null) return { payeeId: row.payeeId };
  if (row.memberId !== null) return { memberId: row.memberId };
  // The database refuses such a row; reaching here means the schema changed.
  throw new Error(`Proposal ${row.id} names nobody to pay`);
}

async function readBills(tx: Transaction, circleId: string) {
  const rows = await tx.select().from(bills).where(eq(bills.circleId, circleId)).orderBy(asc(bills.receivedOn), asc(bills.id));
  return rows.map((row) => ({
    id: row.id,
    payeeId: row.payeeId,
    amountCents: row.amountCents,
    caregiverDetails: caregiverDetails(row),
    receivedOn: row.receivedOn,
    dueOn: row.dueOn,
    state: row.state,
    documentId: row.documentId,
  }));
}

function caregiverDetails(row: { caregiverDetails: unknown; amountCents: number }) {
  if (row.caregiverDetails === null) return null;
  const bill = calculateCaregiverBill(row.caregiverDetails);
  if (bill.cents !== row.amountCents) throw new Error("Stored caregiver bill does not match its service evidence");
  return bill.details;
}

async function readExpectedBills(tx: Transaction, circleId: string) {
  const rows = await tx.select().from(expectedBills).where(eq(expectedBills.circleId, circleId)).orderBy(asc(expectedBills.dueOn), asc(expectedBills.id));
  return rows.map((row) => ({ id: row.id, payeeId: row.payeeId, kind: row.kind, expectedCents: row.expectedCents, dueOn: row.dueOn }));
}

async function readCare(tx: Transaction, circleId: string) {
  const rows = await tx.select().from(careEntries).where(eq(careEntries.circleId, circleId)).orderBy(asc(careEntries.occurredOn), asc(careEntries.id));
  return rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    occurredOn: row.occurredOn,
    minutes: row.minutes,
    note: row.note,
    approved: row.approved,
    entryId: row.ledgerEntryId,
  }));
}

async function readSettlements(tx: Transaction, circleId: string) {
  const rows = await tx
    .select({ id: settlements.id, period: settlements.period, agreementVersion: settlements.agreementVersion, state: settlements.state, calculatedAt: settlements.calculatedAt })
    .from(settlements)
    .where(eq(settlements.circleId, circleId))
    .orderBy(asc(settlements.calculatedAt));
  return rows;
}

async function readClaimChecks(tx: Transaction, circleId: string) {
  const rows = await tx.select().from(claimChecks).where(eq(claimChecks.circleId, circleId)).orderBy(desc(claimChecks.checkedOn), desc(claimChecks.createdAt), asc(claimChecks.id));
  return rows.map((row) => ({
    id: row.id,
    checkedOn: row.checkedOn,
    payeeId: row.payeeId,
    claimedCents: row.claimedCents,
    claim: row.claim,
    foundEntryId: row.foundEntryId,
    verdict: row.verdict,
    alerted: row.alerted,
  }));
}

async function readNarrations(tx: Transaction, circleId: string) {
  const rows = await tx.select().from(narrations).where(eq(narrations.circleId, circleId)).orderBy(desc(narrations.saidOn), desc(narrations.createdAt), asc(narrations.id));
  return rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    topic: row.topic,
    cents: row.cents,
    entryId: row.entryId,
    claimCheckId: row.claimCheckId,
    spokenText: row.spokenText,
    state: row.state,
    saidOn: row.saidOn,
  }));
}

async function readDocuments(tx: Transaction, circleId: string) {
  const rows = await tx
    .select({ id: documents.id, kind: documents.kind, uploadedBy: documents.uploadedBy, simulated: documents.simulated, createdAt: documents.createdAt, extraction: documents.extraction })
    .from(documents)
    .where(eq(documents.circleId, circleId))
    .orderBy(asc(documents.createdAt));
  return rows;
}

async function readInvitations(tx: Transaction, circleId: string) {
  return tx
    .select({ id: invitations.id, email: invitations.email, role: invitations.role, status: invitations.status, expiresAt: invitations.expiresAt })
    .from(invitations)
    .where(eq(invitations.circleId, circleId))
    .orderBy(desc(invitations.createdAt));
}

/** Every share still open or ended, oldest first. Only a share's own member is given the PayPal page to approve it. */
async function readMonthlyShares(tx: Transaction, circleId: string, viewerId: string): Promise<MonthlyShareRecord[]> {
  const rows = await tx.select().from(monthlyShares).where(eq(monthlyShares.circleId, circleId)).orderBy(asc(monthlyShares.createdAt), asc(monthlyShares.id));
  return rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    cents: row.amountCents,
    state: row.state,
    simulated: row.simulated,
    paypalSubscriptionId: row.paypalSubscriptionId,
    approvalUrl: row.memberId === viewerId && row.state === "approval_pending" ? row.approvalUrl : null,
    failedPayments: row.failedPayments,
    nextBillingAt: row.nextBillingAt,
    createdAt: row.createdAt,
  }));
}
