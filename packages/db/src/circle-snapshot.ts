import type {
  Agreement,
  CareAgreementFacts,
  CareAgreementStatus,
  CareEndTerm,
  CarePayer,
  CareRelation,
  DeliveryState,
  ApprovalPlan,
  BillState,
  CircleRole,
  CaregiverBillDetails,
  InvoicePurpose,
  InvoiceRequestState,
  Ledger,
  MandateCadence,
  MandateStatus,
  MemberStatus,
  MonthlyShareState,
  ParentLevel,
  Payee,
  ProposalKind,
  ProposalState,
  ReceiptCategory,
  ShiftCallState,
  ShiftKind,
  ShiftState,
  ShiftWaitingFor,
  SigningCapacity,
  UsState,
  VersionStatus,
} from "@kin/domain";

import type { WishesSnapshot } from "./wishes.ts";
import type { ApprovalMethod, ClaimVerdict, DocumentKind, InvitationStatus, NarrationState, PayoutWallet, ReceiptState, SettlementState } from "./values.ts";

/**
 * Everything a circle's screens show, read in one transaction as the person
 * looking. Row-level security has already removed what their role may not
 * see, so a caregiver's snapshot holds only their own payments.
 */
export type CircleSnapshot = {
  readonly circle: CircleRecord;
  /** The person looking, as a member of this circle. */
  readonly viewer: { readonly memberId: string; readonly role: CircleRole };
  readonly members: readonly MemberRecord[];
  /** The agreement in force. `null` before one is accepted, or for a role that may not see it. */
  readonly agreement: AgreementRecord | null;
  /** Every version, oldest first: earlier ones, the one in force, and any waiting for acceptance. */
  readonly agreementVersions: readonly AgreementVersionRecord[];
  readonly payees: readonly PayeeRecord[];
  readonly ledger: Ledger;
  readonly proposals: readonly ProposalRecord[];
  readonly bills: readonly BillRecord[];
  readonly expectedBills: readonly ExpectedBillRecord[];
  readonly careEntries: readonly CareRecord[];
  readonly settlements: readonly SettlementRecord[];
  /** Receipts members filed, oldest first. A member reads their own; everyone who sees the money reads all. */
  readonly receipts: readonly ReceiptRecord[];
  /** The members who have said where their settlement payout goes, masked. Only the viewer's own is theirs to see in full. */
  readonly settlementReceivers: readonly { readonly memberId: string; readonly receiver: string }[];
  readonly claimChecks: readonly ClaimCheckRecord[];
  readonly narrations: readonly NarrationRecord[];
  /** What the family allowed Kin to buy for the parent. Not shown to a caregiver. */
  readonly purchaseRules: readonly PurchaseRuleRecord[];
  readonly purchases: readonly PurchaseRecord[];
  /** The parent's standing permissions, with this period's use. Not shown to a caregiver. */
  readonly mandates: readonly MandateRecord[];
  /** The calendar of care shifts, by start. A caregiver reads only the shifts they are on. */
  readonly shifts: readonly ShiftRecord[];
  /** The parent's standing permissions to pay a caregiver's confirmed shifts, with today's use. Not shown to a caregiver. */
  readonly shiftPermissions: readonly ShiftPermissionRecord[];
  /** The pay rules and payout wallet of each caregiver the viewer may see. */
  readonly shiftRules: readonly ShiftRulesRecord[];
  /** Whether Kin phones the parent for the family's word, without the number. Only the parent and the organizer are given it; `null` for them until it is set up, and for everyone else. */
  readonly parentCallSettings: ParentCallSettingsRecord | null;
  readonly documents: readonly DocumentRecord[];
  /** Pending and answered invitations. Only an organizer reads them. */
  readonly invitations: readonly InvitationRecord[];
  /** Every member's monthly share, for roles that see the circle's money. */
  readonly monthlyShares: readonly MonthlyShareRecord[];
  /** Requests for money by PayPal invoice, newest first, for roles that see the circle's money. */
  readonly invoiceRequests: readonly InvoiceRequestRecord[];
  /** The written agreements between the parent and each caregiver, oldest first. A caregiver reads only their own. */
  readonly careAgreements: readonly CareAgreementRecord[];
  /** The parent's wishes, their triggers and her subscriptions, with what they do now. A caregiver reads the triggers only. */
  readonly wishes: WishesSnapshot;
};

/** One written care agreement with its signatures, and where it stands on the circle's calendar day. */
export type CareAgreementRecord = {
  readonly id: string;
  readonly payeeId: string;
  readonly caregiverMemberId: string;
  readonly caregiverRelation: CareRelation;
  readonly duties: readonly string[];
  readonly weeklyMinutes: number;
  readonly rateCentsPerHour: number;
  readonly startsOn: string;
  readonly endTerm: CareEndTerm;
  readonly endsOn: string | null;
  /** The last day it covers, when the family ended it early. */
  readonly endedOn: string | null;
  readonly payer: CarePayer;
  readonly usState: UsState;
  readonly state: "draft" | "withdrawn";
  readonly simulated: boolean;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly signatures: readonly { readonly memberId: string; readonly capacity: SigningCapacity; readonly signedOn: string; readonly method: ApprovalMethod; readonly at: Date }[];
  /** Computed from the signatures and the circle's calendar day. */
  readonly status: CareAgreementStatus;
  /** What plain code in the domain reads to decide whether the agreement covers a day of work. */
  readonly facts: CareAgreementFacts;
};

export type InvoiceRequestRecord = {
  readonly id: string;
  /** The member asked to pay. */
  readonly memberId: string;
  readonly requestedBy: string;
  readonly purpose: InvoicePurpose;
  readonly period: string | null;
  readonly cents: number;
  readonly state: InvoiceRequestState;
  /** A demo circle's request with no PayPal invoice behind it. */
  readonly simulated: boolean;
  /** Where PayPal emailed it, masked. */
  readonly recipient: string | null;
  readonly paypalInvoiceId: string | null;
  readonly invoiceNumber: string | null;
  /** PayPal's page for paying it. Only the member asked and the organizers are given it. */
  readonly payerUrl: string | null;
  readonly createdAt: Date;
  readonly paidAt: Date | null;
};

export type MonthlyShareRecord = {
  readonly id: string;
  readonly memberId: string;
  readonly cents: number;
  readonly state: MonthlyShareState;
  /** A demo circle's share: no PayPal subscription stands behind it. */
  readonly simulated: boolean;
  readonly paypalSubscriptionId: string | null;
  /** Where the member approves a share that still waits. Only the member it belongs to is given it. */
  readonly approvalUrl: string | null;
  readonly failedPayments: number;
  readonly nextBillingAt: Date | null;
  readonly createdAt: Date;
};

export type InvitationRecord = {
  readonly id: string;
  readonly email: string;
  readonly role: CircleRole;
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
};

export type CircleRecord = {
  readonly id: string;
  readonly name: string;
  readonly timezone: string;
  readonly currency: string;
  /** A demo circle's money is simulated. */
  readonly demo: boolean;
  /** The circle's "now": the demo clock, or the real time. */
  readonly now: Date;
  readonly pausedUntil: Date | null;
  readonly pausedBy: string | null;
  /**
   * Until when outgoing money is held by an "is it really you?" check, on the
   * circle's clock: while one is open, and for a day after a "not me". `null`
   * when nothing holds it or the viewer may not read the checks. Every path
   * that moves money out reads the same hold (`outgoingMoneyHeldByPresence`).
   */
  readonly heldByPresenceUntil: Date | null;
};

export type MemberRecord = {
  readonly id: string;
  readonly displayName: string;
  readonly role: CircleRole;
  readonly parentLevel: ParentLevel | null;
  readonly relationship: string | null;
  readonly portrait: string | null;
  /** The currency the member gives in, or `null` for the circle's own. */
  readonly currency: string | null;
  readonly status: MemberStatus;
  readonly joinedAt: Date;
};

export type AgreementRecord = Agreement & {
  readonly id: string;
  readonly effectiveOn: string;
  readonly acceptances: readonly { readonly memberId: string; readonly method: ApprovalMethod; readonly at: Date }[];
};

export type AgreementVersionRecord = AgreementRecord & {
  readonly proposedAt: Date;
  readonly status: VersionStatus;
  /** The members holding a share whose acceptance a version still waits for. */
  readonly waitingFor: readonly string[];
};

export type PayeeRecord = {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly caregiverRateCentsPerHour: number | null;
  /** Where PayPal sends their money, masked: screens show that one is recorded, never the full address. */
  readonly receiver: string | null;
  /** The payee as the approval engine reads it. */
  readonly payee: Payee;
};

export type VoteRecord = {
  readonly memberId: string;
  readonly role: CircleRole;
  readonly decision: "approve" | "reject";
  readonly method: ApprovalMethod;
  readonly at: Date;
};

export type ProposalRecord = {
  readonly id: string;
  readonly kind: ProposalKind;
  readonly cents: number;
  /** Who is paid: a payee, or a member being settled with. */
  readonly to: { readonly payeeId: string } | { readonly memberId: string };
  readonly purpose: string;
  readonly note: string | null;
  /** The member who raised it, or `null` when Kin did. */
  readonly raisedBy: string | null;
  readonly raisedAt: Date;
  readonly state: ProposalState;
  readonly expiresAt: Date | null;
  readonly agreementVersion: number;
  /** What the approval engine decided when the proposal was raised. It governs from then on. */
  readonly plan: ApprovalPlan;
  readonly billId: string | null;
  readonly settlementId: string | null;
  readonly documentId: string | null;
  readonly votes: readonly VoteRecord[];
};

export type BillRecord = {
  readonly id: string;
  readonly payeeId: string;
  readonly amountCents: number;
  readonly caregiverDetails: CaregiverBillDetails | null;
  readonly receivedOn: string;
  readonly dueOn: string | null;
  readonly state: BillState;
  readonly documentId: string | null;
};

export type ExpectedBillRecord = {
  readonly id: string;
  readonly payeeId: string;
  readonly kind: ProposalKind;
  readonly expectedCents: number;
  readonly dueOn: string;
};

export type CareRecord = {
  readonly id: string;
  readonly memberId: string;
  readonly occurredOn: string;
  readonly minutes: number;
  readonly note: string | null;
  readonly approved: boolean;
  readonly entryId: string | null;
};

export type SettlementRecord = {
  readonly id: string;
  readonly period: string;
  readonly agreementVersion: number;
  readonly state: SettlementState;
  readonly calculatedAt: Date;
};

export type ReceiptRecord = {
  readonly id: string;
  /** The member who spent the money and is credited. */
  readonly memberId: string;
  readonly category: ReceiptCategory;
  readonly cents: number;
  readonly description: string;
  readonly spentOn: string;
  readonly state: ReceiptState;
  readonly decidedBy: string | null;
  readonly entryId: string | null;
  /** The bill read from a letter it says the member paid outside Kin, when it is one. */
  readonly billId: string | null;
};

export type ClaimCheckRecord = {
  readonly id: string;
  readonly checkedOn: string;
  readonly payeeId: string | null;
  readonly claimedCents: number | null;
  readonly claim: string;
  readonly foundEntryId: string | null;
  readonly verdict: ClaimVerdict;
  readonly alerted: readonly string[];
};

export type NarrationRecord = {
  readonly id: string;
  readonly memberId: string;
  readonly topic: string;
  readonly cents: number | null;
  readonly entryId: string | null;
  readonly claimCheckId: string | null;
  readonly spokenText: string | null;
  readonly state: NarrationState;
  readonly saidOn: string;
};

export type PurchaseRuleRecord = {
  readonly id: string;
  readonly payeeId: string;
  readonly item: string;
  readonly category: string;
  readonly priceCents: number;
  readonly limitCents: number;
  readonly monthlyBudgetCents: number;
  /** What this rule's purchases already cost this month, counting those waiting for a yes. */
  readonly committedCents: number;
};

export type MandateRecord = {
  readonly id: string;
  readonly ruleId: string;
  /** The parent whose permission it is. */
  readonly grantedBy: string;
  /** Who recorded it: the parent, or in a demo circle the organizer playing the parent's spoken yes. */
  readonly recordedBy: string;
  readonly perPurchaseCents: number;
  readonly perPeriodCents: number;
  readonly cadence: MandateCadence;
  readonly validFrom: string;
  readonly expiresOn: string;
  readonly status: MandateStatus;
  readonly spokenText: string | null;
  /** A grant made in a demo circle is simulated, and shown so. */
  readonly simulated: boolean;
  readonly digest: string;
  readonly grantedAt: Date;
  readonly endedAt: Date | null;
  /** What this period's purchases under it cost, counting those still waiting. */
  readonly usedCents: number;
  readonly usedCount: number;
  readonly uses: readonly { readonly proposalId: string; readonly cents: number; readonly period: string; readonly at: Date; readonly state: string }[];
};

export type ShiftRecord = {
  readonly id: string;
  readonly kind: ShiftKind;
  readonly title: string | null;
  /** The member who does the shift. */
  readonly memberId: string;
  /** Whom an aide's shift pays. */
  readonly payeeId: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly state: ShiftState;
  readonly checkedInAt: Date | null;
  readonly checkedOutAt: Date | null;
  readonly familyConfirmedAt: Date | null;
  readonly familyConfirmedBy: string | null;
  readonly familyConfirmation: "parent" | "sibling" | null;
  readonly workedMinutes: number | null;
  readonly billableMinutes: number | null;
  /** What the shift is worth, set by the database when it was priced. */
  readonly cents: number | null;
  readonly rateCentsPerHour: number | null;
  readonly proposalId: string | null;
  /** Where its payment stands, or `null` before one exists or when the viewer may not read it. */
  readonly proposalState: ProposalState | null;
  /** The standing permission that covered it, when one did. */
  readonly permissionId: string | null;
  /** A demo circle's shift is simulated, and its pay too. */
  readonly simulated: boolean;
  /** Which key a shift still waits for; `null` once both have turned, and for a cancelled shift. */
  readonly waitingFor: ShiftWaitingFor;
  /** How Kin's latest call to the parent about this shift went, or `null` when none was made or the viewer is a caregiver. */
  readonly callState: ShiftCallState | null;
  /** What a credited visit or drive counted for, in whole minutes and cents, from its care entry and its ledger entry; `null` for any other shift. */
  readonly creditedMinutes: number | null;
  readonly creditedCents: number | null;
};

/** Kin's call to the parent, as the parent and the organizer see it. The phone number is never part of it. */
export type ParentCallSettingsRecord = {
  /** The circle's parent, whose word the call records. */
  readonly memberId: string;
  readonly enabled: boolean;
  /** The language Kin speaks to her in. */
  readonly locale: string;
  /** Who gave the consent, and when it was recorded. `null` until a call was first switched on. */
  readonly consentedBy: string | null;
  readonly consentedAt: Date | null;
  /** No call is placed from the start of the quiet hours until their end, as local times of day (HH:MM:SS) on the circle's clock. */
  readonly quietStart: string;
  readonly quietEnd: string;
};

export type ShiftPermissionRecord = {
  readonly id: string;
  /** The caregiver's payee row it covers. */
  readonly payeeId: string;
  /** The parent whose permission it is. */
  readonly grantedBy: string;
  /** Who recorded it: the parent, or in a demo circle the organizer playing the parent's spoken yes. */
  readonly recordedBy: string;
  readonly maxMinutesPerDay: number;
  readonly perShiftCents: number;
  readonly validFrom: string;
  readonly expiresOn: string;
  readonly status: MandateStatus;
  readonly spokenText: string | null;
  readonly simulated: boolean;
  readonly digest: string;
  readonly grantedAt: Date;
  readonly endedAt: Date | null;
  /** Minutes of shifts paid, or waiting to be, under it on the circle's calendar day now. */
  readonly usedMinutesToday: number;
  readonly uses: readonly {
    readonly shiftId: string;
    readonly proposalId: string;
    readonly cents: number;
    readonly minutes: number;
    readonly day: string;
    readonly at: Date;
    readonly state: ProposalState;
  }[];
};

export type ShiftRulesRecord = {
  readonly payeeId: string;
  readonly minimumMinutes: number;
  readonly overtimeAfterMinutes: number | null;
  readonly overtimePercent: number;
  /** Where the caregiver's pay lands. */
  readonly payoutWallet: PayoutWallet;
};

export type PurchaseRecord = {
  readonly id: string;
  readonly ruleId: string;
  readonly proposalId: string;
  readonly item: string;
  readonly cents: number;
  readonly state: DeliveryState;
  readonly merchantOrder: string | null;
  readonly orderedAt: Date | null;
  readonly deliveredAt: Date | null;
  /**
   * What the bought refill's ledger entry stands on, from Kin's execution record: PayPal's capture ID for a sandbox
   * charge, or a simulated purchase's marker. `null` until it is bought. Whether it is simulated is the ledger entry's to say.
   */
  readonly paidItemId: string | null;
};

export type DocumentRecord = {
  readonly id: string;
  readonly kind: DocumentKind;
  readonly uploadedBy: string | null;
  readonly simulated: boolean;
  readonly createdAt: Date;
  /** What Kin read from it, still to be parsed by the reader: stored JSON, never trusted as typed. */
  readonly extraction: unknown;
};
