import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { at, cents, circleId, createdAt, id } from "./columns.ts";
import { circles, members } from "./circles.ts";
import { approvalMethod, circleRole, executionState, proposalKind, proposalState, voteDecision } from "./enums.ts";
import { bills, documents, payees } from "./payees.ts";
import { settlements } from "./records.ts";

/** A movement of money Kin or a member asks the circle to approve. */
export const proposals = pgTable(
  "proposals",
  {
    id: id(),
    circleId: circleId(),
    kind: proposalKind("kind").notNull(),
    cents: cents("cents").notNull(),
    /** Who is paid: a payee, or a member being settled with. Exactly one is set. */
    payeeId: uuid("payee_id"),
    memberId: uuid("member_id"),
    /** What the proposal is for, as a key the app words in each language. */
    purpose: text("purpose").notNull(),
    /** The family's own words about it, shown as written. */
    note: text("note"),
    /** The member who raised it, or `null` when Kin raised it. */
    raisedBy: uuid("raised_by"),
    raisedAt: at("raised_at").notNull(),
    state: proposalState("state").notNull().default("proposed"),
    expiresAt: at("expires_at"),
    agreementVersion: integer("agreement_version").notNull(),
    /** The approval engine's plan when the proposal was raised. */
    plan: jsonb("plan").notNull(),
    billId: uuid("bill_id"),
    settlementId: uuid("settlement_id"),
    documentId: uuid("document_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "proposals_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "proposals_payee_fk", columns: [t.circleId, t.payeeId], foreignColumns: [payees.circleId, payees.id] }),
    foreignKey({ name: "proposals_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "proposals_raised_by_fk", columns: [t.circleId, t.raisedBy], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "proposals_bill_fk", columns: [t.circleId, t.billId], foreignColumns: [bills.circleId, bills.id] }),
    foreignKey({ name: "proposals_settlement_fk", columns: [t.circleId, t.settlementId], foreignColumns: [settlements.circleId, settlements.id] }),
    foreignKey({ name: "proposals_document_fk", columns: [t.circleId, t.documentId], foreignColumns: [documents.circleId, documents.id] }),
    unique("proposals_circle_row").on(t.circleId, t.id),
    index("proposals_state_idx").on(t.circleId, t.state),
    check("proposals_cents_positive", sql`${t.cents} > 0`),
    check("proposals_one_recipient", sql`(${t.payeeId} is null) <> (${t.memberId} is null)`),
    check("proposals_member_payout_to_member", sql`(${t.kind} = 'member_payout') = (${t.memberId} is not null)`),
    check("proposals_purpose_key", sql`${t.purpose} ~ '^[a-zA-Z0-9_-]+$'`),
  ],
);

/**
 * One member's recorded answer to a proposal. Append-only, like the ledger:
 * an answer is evidence and is never changed.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    circleId: circleId(),
    proposalId: uuid("proposal_id").notNull(),
    memberId: uuid("member_id").notNull(),
    /** The member's role when they answered. */
    role: circleRole("role").notNull(),
    decision: voteDecision("decision").notNull(),
    method: approvalMethod("method").notNull(),
    /** What proves the answer: a call session, a multi-factor check. */
    evidenceRef: text("evidence_ref"),
    decidedAt: at("decided_at").notNull(),
  },
  (t) => [
    foreignKey({ name: "approvals_proposal_fk", columns: [t.circleId, t.proposalId], foreignColumns: [proposals.circleId, proposals.id] }),
    foreignKey({ name: "approvals_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    unique("approvals_one_per_member").on(t.proposalId, t.memberId),
  ],
);

/** One attempt to carry out an approved proposal through PayPal. */
export const executions = pgTable(
  "executions",
  {
    id: id(),
    circleId: circleId(),
    proposalId: uuid("proposal_id").notNull(),
    /** Sent to PayPal with the request, so a repeat cannot move money twice. */
    idempotencyKey: text("idempotency_key").notNull(),
    state: executionState("state").notNull().default("created"),
    paypalBatchId: text("paypal_batch_id"),
    paypalItemId: text("paypal_item_id"),
    paypalOrderId: text("paypal_order_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    submittedAt: at("submitted_at"),
    confirmedAt: at("confirmed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "executions_proposal_fk", columns: [t.circleId, t.proposalId], foreignColumns: [proposals.circleId, proposals.id] }),
    unique("executions_idempotency_key").on(t.idempotencyKey),
    check("executions_attempts", sql`${t.attempts} >= 0`),
    check("executions_key_present", sql`length(trim(${t.idempotencyKey})) > 0`),
  ],
);
