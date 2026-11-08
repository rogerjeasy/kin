/**
 * The closed sets of values the database stores beside the money core's own.
 * Each becomes a PostgreSQL enum, and code reads its type from here.
 */

/** An archived circle is kept, never deleted, and no member can open it. */
/**
 * Who a user row stands for: a person who signed in with Cognito, or an
 * anonymous visitor who pressed the Demo button. A visitor's ID starts with
 * "demo:", and they can only ever hold seats in demo circles.
 */
export const USER_KINDS = ["person", "demo_visitor"] as const;
export type UserKind = (typeof USER_KINDS)[number];

/** The prefix of every demo visitor's ID. A Cognito subject never has it. */
export const DEMO_VISITOR_PREFIX = "demo:";

export const CIRCLE_STATUSES = ["active", "archived"] as const;
export type CircleStatus = (typeof CIRCLE_STATUSES)[number];

export const INVITATION_STATUSES = ["pending", "accepted", "declined", "expired"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const PAYEE_STATUSES = ["approved", "new"] as const;

export const VOTE_DECISIONS = ["approve", "reject"] as const;

/** How a yes was given: in the app, by voice on a verified call, or by the parent's standing mandate. */
export const APPROVAL_METHODS = ["app", "voice", "mandate"] as const;
export type ApprovalMethod = (typeof APPROVAL_METHODS)[number];

export const DOCUMENT_KINDS = ["bill", "receipt", "quote", "letter", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * A member's receipt for money spent from their own pocket: filed, answered
 * by another member, and once approved credited to the ledger by Kin's worker.
 */
export const RECEIPT_STATES = ["submitted", "approved", "rejected", "credited"] as const;
export type ReceiptState = (typeof RECEIPT_STATES)[number];

export const SETTLEMENT_STATES =["proposed", "approved", "settled", "superseded"] as const;
export type SettlementState = (typeof SETTLEMENT_STATES)[number];

/** Plain code's verdict on a demand for money, docs/architecture.md section 9.5. */
export const CLAIM_VERDICTS = ["match", "no_match", "unclear"] as const;
export type ClaimVerdict = (typeof CLAIM_VERDICTS)[number];

export const NARRATION_STATES = ["queued", "delivered", "failed"] as const;
export type NarrationState = (typeof NARRATION_STATES)[number];

export const PAYPAL_EVENT_STATES = ["received", "verified", "rejected", "processed", "failed"] as const;

/** Who acted: a signed-in member, Kin's own services, or the demo provisioner. */
export const AUDIT_ACTORS = ["member", "service", "provisioner"] as const;
export type AuditActor = (typeof AUDIT_ACTORS)[number];

/** Where a caregiver's pay lands: a PayPal wallet, or their Venmo account through PayPal Payouts. */
export const PAYOUT_WALLETS = ["paypal", "venmo"] as const;
export type PayoutWallet = (typeof PAYOUT_WALLETS)[number];
