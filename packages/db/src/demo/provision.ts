import {
  entryHeadline,
  formatMoney,
  planApprovals,
  rosesMonth,
  settlePeriod,
  type Agreement,
  type ApprovalPlan,
  type CircleRole,
  type LedgerEntry,
  type Payee,
  type ProposalKind,
} from "@kin/domain";
import { randomUUID } from "node:crypto";

import type { Database, Transaction } from "../connection.ts";
import { writeEntries } from "../ledger-store.ts";
import { mandateDigest } from "../mandates.ts";
import { demoTime, type DemoTime } from "./demo-time.ts";
import { rekeyEntry, rowOf } from "./rekey.ts";
import { writeOpenKin } from "./write-open-kin.ts";
import { writeShifts } from "./write-shifts.ts";
import { asProvisioner } from "../scope.ts";
import {
  agreementAcceptances,
  agreements,
  agreementShares,
  approvals,
  auditLog,
  bills,
  careAgreements,
  careAgreementSignatures,
  careEntries,
  circles,
  claimChecks,
  documents,
  expectedBills,
  mandates,
  members,
  narrations,
  payees,
  proposals,
  purchaseRules,
  quietShareAsks,
  sealedOffers,
  settlements,
  trustedVoices,
} from "../schema/index.ts";
import {
  ACCEPTANCES,
  AGREEMENT_EFFECTIVE_ON,
  BILLS,
  CARE,
  CARE_AGREEMENT,
  CLAIM_CHECK,
  DEMO_TRUSTED_VOICES,
  DOCUMENTS,
  EXPECTED_BILLS,
  MANDATES,
  NARRATIONS,
  PAYEES,
  PERSONAS,
  PROPOSALS,
  PURCHASE_RULES,
  QUIET_SHARE_ASK,
  ROSES_CIRCLE,
  SETTLED_AT,
  type PayeeKey,
  type PersonaKey,
} from "./roses-circle.ts";

export type ProvisionedCircle = {
  readonly circleId: string;
  /** The row IDs given to each persona and payee, by key. */
  readonly members: Readonly<Record<PersonaKey, string>>;
  readonly payees: Readonly<Record<PayeeKey, string>>;
};

type Ids = ProvisionedCircle & {
  readonly agreementId: string;
  readonly documents: ReadonlyMap<string, string>;
  readonly bills: ReadonlyMap<string, string>;
  /** Where the template's dates fall for this copy. */
  readonly time: DemoTime;
};

const keyed = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((key) => [key, randomUUID()])) as Record<K, string>;
const byKey = <T>(rows: readonly T[], key: (row: T) => string) => new Map(rows.map((row) => [key(row), randomUUID()]));

/**
 * Creates a fresh copy of Rose's circle and seats the demo visitor `userId`
 * as Elena, the organizer. The database refuses to seat anyone else in it. It runs as the provisioner, which can add rows only to the
 * circle created in this same transaction and can read nothing, so it can
 * never touch another family's circle.
 *
 * `userId` is `null` for a circle nobody can open yet, such as a local seed.
 * `now` is the moment the visitor pressed the Demo button: it becomes the
 * circle's clock, and Rose's month is moved to end there.
 */
export function provisionDemoCircle(db: Database, userId: string | null, now: Date): Promise<ProvisionedCircle> {
  const ids: Ids = {
    time: demoTime(ROSES_CIRCLE.clockAt, now, ROSES_CIRCLE.timezone),
    circleId: randomUUID(),
    members: keyed(PERSONAS.map((persona) => persona.key)),
    payees: keyed(PAYEES.map((payee) => payee.key)),
    agreementId: randomUUID(),
    documents: byKey(DOCUMENTS, (document) => document.key),
    bills: byKey(BILLS, (bill) => bill.key),
  };
  return asProvisioner(db, async (tx) => {
    await writePeople(tx, ids, userId);
    const agreement = await writeAgreement(tx, ids);
    await writePayees(tx, ids);
    await writeCareAgreement(tx, ids);
    const ledger = rekeyLedger(ids);
    await writeEntries(tx, ledger, new Map());
    await writeBills(tx, ids, ledger);
    await writeQuietShare(tx, ids);
    await writeProposals(tx, ids, agreement, ledger);
    const ruleIds = await writePurchaseRules(tx, ids);
    await writeMandates(tx, ids, ruleIds);
    await writeShifts(tx, ids);
    await writeNews(tx, ids, ledger);
    await writeTrustedVoices(tx, ids);
    await writeOpenKin(tx, ids);
    await tx.insert(auditLog).values({
      id: randomUUID(),
      circleId: ids.circleId,
      actor: "provisioner",
      action: "circle.provisioned",
      subjectType: "circle",
      subjectId: ids.circleId,
      details: { template: "roses-circle", seat: userId === null ? null : ROSES_CIRCLE.visitorSeat },
      origin: "demo",
    });
    return { circleId: ids.circleId, members: ids.members, payees: ids.payees };
  });
}

/**
 * The stairlift the pool cannot pay alone, asked of the family with quiet
 * shares. Elena has sealed her offer; Marcus and Ana have not answered, so the
 * plan lands the moment they do. Her offer is hers alone to read, here as in
 * any circle.
 */
async function writeQuietShare(tx: Transaction, ids: Ids): Promise<void> {
  const askId = randomUUID();
  const ask = QUIET_SHARE_ASK;
  await tx.insert(quietShareAsks).values({
    id: askId,
    circleId: ids.circleId,
    title: ask.title,
    kind: ask.kind,
    costCents: ask.costCents,
    billId: ids.bills.get(ask.bill) ?? null,
    agreementId: ids.agreementId,
    asked: rosesMonth.agreement.shares.map((share) => rowOf(ids.members, share.memberId)),
    startMonth: ids.time.period,
    answeredCount: ask.offers.length,
    simulated: true,
    raisedBy: ids.members[ask.raisedBy],
    createdAt: ids.time.at(ask.raisedAt),
  });
  await tx.insert(sealedOffers).values(
    ask.offers.map((offer) => ({
      id: randomUUID(),
      circleId: ids.circleId,
      askId,
      memberId: ids.members[offer.member],
      monthlyCents: offer.monthlyCents,
      sealedAt: ids.time.at(offer.sealedAt),
    })),
  );
}

/** The family members Kin may ask, confirmed from the start: stand-ins, so nothing is texted. */
async function writeTrustedVoices(tx: Transaction, ids: Ids): Promise<void> {
  await tx.insert(trustedVoices).values(
    DEMO_TRUSTED_VOICES.map((voice) => ({
      id: randomUUID(),
      circleId: ids.circleId,
      name: voice.name,
      relationship: voice.relationship,
      phone: voice.phone,
      locale: voice.locale,
      aliases: [...voice.aliases],
      paypalReceiver: voice.paypalReceiver,
      receiverConfirmedAt: ids.time.now,
      confirmedAt: ids.time.now,
      addedBy: ids.members[voice.addedBy],
      simulated: true,
    })),
  );
}

async function writePeople(tx: Transaction, ids: Ids, userId: string | null): Promise<void> {
  await tx.insert(circles).values({
    id: ids.circleId,
    name: ROSES_CIRCLE.name,
    timezone: ROSES_CIRCLE.timezone,
    currency: ROSES_CIRCLE.currency,
    demo: true,
    clockAt: ids.time.now,
  });
  await tx.insert(members).values(
    PERSONAS.map((persona) => ({
      id: ids.members[persona.key],
      circleId: ids.circleId,
      userId: persona.key === ROSES_CIRCLE.visitorSeat ? userId : null,
      demoSeat: persona.key === ROSES_CIRCLE.visitorSeat && userId !== null,
      displayName: persona.name,
      role: persona.role,
      parentLevel: persona.parentLevel,
      relationship: persona.relationship,
      currency: persona.currency ?? null,
      // Daniel has no photograph, so he is drawn by his initials.
      portrait: persona.key === "daniel" ? null : persona.key,
      joinedAt: ids.time.at(persona.joinedAt),
    })),
  );
}

/** The example agreement, with each share pointing at its member's row. */
async function writeAgreement(tx: Transaction, ids: Ids): Promise<Agreement> {
  const example = rosesMonth.agreement;
  const agreement: Agreement = {
    ...example,
    shares: example.shares.map((share) => ({ ...share, memberId: rowOf(ids.members, share.memberId) })),
  };
  await tx.insert(agreements).values({
    id: ids.agreementId,
    circleId: ids.circleId,
    version: agreement.version,
    careRateCentsPerHour: agreement.care?.rateCentsPerHour ?? null,
    carePaidInCash: agreement.care?.paidInCash ?? false,
    ceilingCents: agreement.approvals.ceilingCents,
    secondApprovalAboveCents: agreement.approvals.secondApprovalAboveCents,
    parentDecidesAboveCents: agreement.approvals.parentDecidesAboveCents,
    effectiveOn: ids.time.day(AGREEMENT_EFFECTIVE_ON),
  });
  await tx.insert(agreementShares).values(
    agreement.shares.map((share, position) => ({
      id: randomUUID(),
      circleId: ids.circleId,
      agreementId: ids.agreementId,
      memberId: share.memberId,
      bps: share.bps,
      position,
    })),
  );
  await tx.insert(agreementAcceptances).values(
    ACCEPTANCES.map((acceptance) => ({
      id: randomUUID(),
      circleId: ids.circleId,
      agreementId: ids.agreementId,
      memberId: ids.members[acceptance.member],
      method: acceptance.method,
      acceptedAt: ids.time.at(acceptance.at),
    })),
  );
  return agreement;
}

async function writePayees(tx: Transaction, ids: Ids): Promise<void> {
  await tx.insert(payees).values(
    PAYEES.map((payee) => ({
      id: ids.payees[payee.key],
      circleId: ids.circleId,
      name: payee.name,
      category: payee.category,
      status: payee.status,
      memberId: payee.member === null ? null : ids.members[payee.member],
      autoPayRuleId: payee.autoPay?.ruleId ?? null,
      autoPayMinCents: payee.autoPay?.minCents ?? null,
      autoPayMaxCents: payee.autoPay?.maxCents ?? null,
      caregiverRateCentsPerHour: payee.caregiver?.rateCentsPerHour ?? null,
      shiftMinimumMinutes: payee.caregiver?.minimumMinutes ?? 0,
      shiftOvertimeAfterMinutes: payee.caregiver?.overtimeAfterMinutes ?? null,
      shiftOvertimePercent: payee.caregiver?.overtimePercent ?? 150,
    })),
  );
}

/** Amara's signed care agreement, simulated, signed on the days the template says, moved to this copy's clock. */
async function writeCareAgreement(tx: Transaction, ids: Ids): Promise<void> {
  const id = randomUUID();
  const { terms } = CARE_AGREEMENT;
  await tx.insert(careAgreements).values({
    id,
    circleId: ids.circleId,
    payeeId: ids.payees[CARE_AGREEMENT.payee],
    caregiverMemberId: ids.members.amara,
    caregiverRelation: terms.caregiverRelation,
    duties: [...terms.duties],
    weeklyMinutes: terms.weeklyMinutes,
    rateCentsPerHour: terms.rateCentsPerHour,
    startsOn: ids.time.day(terms.startsOn),
    endTerm: terms.endTerm,
    endsOn: terms.endsOn,
    payer: terms.payer,
    usState: terms.state,
    simulated: true,
    createdBy: ids.members[CARE_AGREEMENT.createdBy],
    createdAt: ids.time.at(CARE_AGREEMENT.createdAt),
  });
  await tx.insert(careAgreementSignatures).values(
    CARE_AGREEMENT.signatures.map((signature) => ({
      id: randomUUID(),
      circleId: ids.circleId,
      agreementId: id,
      memberId: ids.members[signature.member],
      capacity: signature.capacity,
      method: "app" as const,
      signedOn: ids.time.day(signature.at.toISOString().slice(0, 10)),
      signedAt: ids.time.at(signature.at),
    })),
  );
}

/**
 * Rose's month with fresh entry IDs, accounts naming this circle's rows, and
 * its dates moved to end on this copy's clock. The whole month counts toward
 * the period open on that clock, so the story settles as one month whatever
 * the day of the press.
 */
function rekeyLedger(ids: Ids): LedgerEntry[] {
  return rosesMonth.ledger.entries.map((entry) =>
    rekeyEntry({ ...entry, occurredOn: ids.time.day(entry.occurredOn), period: ids.time.period }, { circleId: ids.circleId, members: ids.members, payees: ids.payees }),
  );
}

function entryFrom(ledger: readonly LedgerEntry[], source: string): LedgerEntry {
  const entry = ledger.find((each) => each.source.id === source);
  if (!entry) throw new Error(`Rose's month records nothing from ${source}`);
  return entry;
}

function mapped(map: ReadonlyMap<string, string>, key: string): string {
  const id = map.get(key);
  if (id === undefined) throw new Error(`Rose's circle has no row for ${key}`);
  return id;
}

async function writeBills(tx: Transaction, ids: Ids, ledger: readonly LedgerEntry[]): Promise<void> {
  await tx.insert(documents).values(
    DOCUMENTS.map((document) => ({
      id: mapped(ids.documents, document.key),
      circleId: ids.circleId,
      kind: document.kind,
      uploadedBy: ids.members[document.uploadedBy],
      simulated: true,
      createdAt: ids.time.at(document.at),
    })),
  );
  await tx.insert(bills).values(
    BILLS.map((bill) => ({
      id: mapped(ids.bills, bill.key),
      circleId: ids.circleId,
      payeeId: ids.payees[bill.payee],
      documentId: bill.document === null ? null : mapped(ids.documents, bill.document),
      amountCents: bill.cents,
      receivedOn: ids.time.day(bill.receivedOn),
      dueOn: bill.dueOn === null ? null : ids.time.day(bill.dueOn),
      state: bill.state,
    })),
  );
  await tx.insert(careEntries).values(
    CARE.map((care) => ({
      id: randomUUID(),
      circleId: ids.circleId,
      memberId: ids.members[care.member],
      occurredOn: ids.time.day(care.occurredOn),
      minutes: care.minutes,
      note: care.note,
      approved: true,
      ledgerEntryId: entryFrom(ledger, care.source).id,
    })),
  );
}

type ProposalRow = typeof proposals.$inferInsert;

/** Asks the approval engine who must say yes, as Kin does when a proposal is raised. */
function pendingPlan(kind: ProposalKind, cents: number, payee: Payee, agreement: Agreement, raisedAt: Date) {
  const plan: ApprovalPlan = planApprovals({ kind, cents, payee, agreement, parentLevel: "decides", pausedUntil: null, now: raisedAt });
  if (plan.outcome !== "needs_approval") throw new Error(`A demo ${kind} of ${cents} would not wait for approval`);
  return plan;
}

function payeeRecord(ids: Ids, key: PayeeKey): Payee {
  const payee = PAYEES.find((each) => each.key === key);
  if (!payee) throw new Error(`Rose's circle has no payee ${key}`);
  return {
    status: payee.status,
    member: payee.member === null ? null : { memberId: ids.members[payee.member], role: personaRole(payee.member) },
    autoPay: payee.autoPay,
  };
}

async function writeProposals(tx: Transaction, ids: Ids, agreement: Agreement, ledger: readonly LedgerEntry[]): Promise<void> {
  const raised = PROPOSALS.map((proposal) => {
    const raisedAt = ids.time.at(proposal.raisedAt);
    const plan = pendingPlan(proposal.kind, proposal.cents, payeeRecord(ids, proposal.payee), agreement, raisedAt);
    const row: ProposalRow = {
      id: randomUUID(),
      circleId: ids.circleId,
      kind: proposal.kind,
      cents: proposal.cents,
      payeeId: ids.payees[proposal.payee],
      purpose: proposal.purpose,
      note: proposal.note,
      raisedBy: ids.members[proposal.raisedBy],
      raisedAt,
      state: "pending_approval",
      expiresAt: plan.expiresAt,
      agreementVersion: agreement.version,
      plan,
      billId: proposal.bill === null ? null : mapped(ids.bills, proposal.bill),
      documentId: proposal.document === null ? null : mapped(ids.documents, proposal.document),
    };
    const votes = proposal.votes.map((vote) => ({
      id: randomUUID(),
      circleId: ids.circleId,
      proposalId: row.id,
      memberId: ids.members[vote.member],
      role: personaRole(vote.member),
      decision: "approve" as const,
      method: vote.method,
      evidenceRef: vote.method === "voice" ? "demo-call" : null,
      decidedAt: ids.time.at(vote.at),
    }));
    return { row, votes };
  });
  const payouts = await writeSettlement(tx, ids, agreement, ledger);
  await tx.insert(proposals).values([...raised.map((each) => each.row), ...payouts]);
  const votes = raised.flatMap((each) => each.votes);
  if (votes.length > 0) await tx.insert(approvals).values(votes);
}

/** The refills the family let Kin propose, from the pharmacy they already pay. */
async function writePurchaseRules(tx: Transaction, ids: Ids): Promise<ReadonlyMap<PayeeKey, string>> {
  const ruleIds = new Map(PURCHASE_RULES.map((rule) => [rule.seller, randomUUID()] as const));
  await tx.insert(purchaseRules).values(
    PURCHASE_RULES.map((rule) => ({
      id: ruleIds.get(rule.seller) ?? randomUUID(),
      circleId: ids.circleId,
      payeeId: ids.payees[rule.seller],
      item: rule.item,
      category: rule.category,
      priceCents: rule.priceCents,
      limitCents: rule.limitCents,
      monthlyBudgetCents: rule.monthlyBudgetCents,
    })),
  );
  return ruleIds;
}

/** Rose's spoken permission, recorded as her own call would have: simulated, and sealed like any mandate. */
async function writeMandates(tx: Transaction, ids: Ids, ruleIds: ReadonlyMap<PayeeKey, string>): Promise<void> {
  await tx.insert(mandates).values(
    MANDATES.map((mandate) => {
      const ruleId = ruleIds.get(mandate.seller);
      if (ruleId === undefined) throw new Error("Rose's circle has no refill rule for " + mandate.seller);
      const terms = {
        ruleId,
        perPurchaseCents: mandate.perPurchaseCents,
        perPeriodCents: mandate.perPeriodCents,
        cadence: "monthly" as const,
        validFrom: ids.time.day(mandate.validFrom),
        expiresOn: ids.time.day(mandate.expiresOn),
      };
      return {
        id: randomUUID(),
        circleId: ids.circleId,
        ...terms,
        grantedBy: ids.members.rose,
        recordedBy: ids.members.rose,
        status: "active" as const,
        spokenText: mandate.spokenText,
        evidenceRef: "demo-call",
        simulated: true,
        digest: mandateDigest(terms),
        grantedAt: ids.time.at(mandate.grantedAt),
      };
    }),
  );
}

function personaRole(key: PersonaKey): CircleRole {
  const persona = PERSONAS.find((each) => each.key === key);
  if (!persona) throw new Error(`Rose's circle has no member ${key}`);
  return persona.role;
}

/** Closes the month in the money core, from this circle's own ledger, and raises its payouts. */
async function writeSettlement(tx: Transaction, ids: Ids, agreement: Agreement, ledger: readonly LedgerEntry[]): Promise<ProposalRow[]> {
  const settlement = settlePeriod({
    ledger: { circleId: ids.circleId, currency: ROSES_CIRCLE.currency, entries: ledger },
    agreement,
    period: ids.time.period,
    payoutFee: rosesMonth.payoutFee,
  });
  const settledAt = ids.time.at(SETTLED_AT);
  const settlementId = randomUUID();
  await tx.insert(settlements).values({
    id: settlementId,
    circleId: ids.circleId,
    period: settlement.period,
    agreementVersion: settlement.agreementVersion,
    inputs: settlement.inputs,
    fairness: settlement.fairness,
    plan: settlement.plan,
    calculatedAt: settledAt,
  });
  return settlement.plan.payouts.map((payout) => {
    const persona = PERSONAS.find((each) => ids.members[each.key] === payout.memberId);
    if (!persona) throw new Error("The settlement pays someone outside Rose's circle");
    const payee: Payee = { status: "approved", member: { memberId: payout.memberId, role: persona.role }, autoPay: null };
    const plan = pendingPlan("member_payout", payout.cents, payee, agreement, settledAt);
    return {
      id: randomUUID(),
      circleId: ids.circleId,
      kind: "member_payout",
      cents: payout.cents,
      memberId: payout.memberId,
      purpose: "settlement",
      raisedBy: null,
      raisedAt: settledAt,
      state: "pending_approval",
      expiresAt: plan.expiresAt,
      agreementVersion: agreement.version,
      plan,
      settlementId,
    };
  });
}

async function writeNews(tx: Transaction, ids: Ids, ledger: readonly LedgerEntry[]): Promise<void> {
  await tx.insert(expectedBills).values(
    EXPECTED_BILLS.map((bill) => ({
      id: randomUUID(),
      circleId: ids.circleId,
      payeeId: ids.payees[bill.payee],
      kind: bill.kind,
      expectedCents: bill.cents,
      dueOn: ids.time.day(bill.dueOn),
    })),
  );
  const claimCheckId = randomUUID();
  await tx.insert(claimChecks).values({
    id: claimCheckId,
    circleId: ids.circleId,
    checkedOn: ids.time.day(CLAIM_CHECK.checkedOn),
    payeeId: ids.payees[CLAIM_CHECK.payee],
    claimedCents: CLAIM_CHECK.claimedCents,
    claim: CLAIM_CHECK.claim,
    foundEntryId: entryFrom(ledger, CLAIM_CHECK.foundSource).id,
    verdict: CLAIM_CHECK.verdict,
    alerted: CLAIM_CHECK.alerted.map((member) => ids.members[member]),
  });
  await tx.insert(narrations).values(
    NARRATIONS.map((narration) => {
      const entry = entryFrom(ledger, narration.source);
      // The amount Rose hears is the entry's own, put into the words here.
      const { cents } = entryHeadline(entry);
      return {
        id: randomUUID(),
        circleId: ids.circleId,
        memberId: ids.members.rose,
        topic: narration.topic,
        cents,
        entryId: entry.id,
        claimCheckId: narration.claimCheck ? claimCheckId : null,
        spokenText: narration.words(formatMoney({ cents, currency: entry.currency }, "en-US")),
        state: "delivered" as const,
        saidOn: ids.time.day(narration.saidOn),
        deliveredAt: ids.time.at(new Date(`${narration.saidOn}T16:00:00Z`)),
      };
    }),
  );
}
