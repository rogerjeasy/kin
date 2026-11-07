import type {
  Agreement,
  DeliveryState,
  ApprovalPlan,
  BillState,
  CircleRole,
  CaregiverBillDetails,
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
  VersionStatus,
} from "@kin/domain";

import type { ApprovalMethod, ClaimVerdict, DocumentKind, InvitationStatus, NarrationState, ReceiptState, SettlementState } from "./values.ts";

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
  readonly documents: readonly DocumentRecord[];
  /** Pending and answered invitations. Only an organizer reads them. */
  readonly invitations: readonly InvitationRecord[];
  /** Every member's monthly share, for roles that see the circle's money. */
  readonly monthlyShares: readonly MonthlyShareRecord[];
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
