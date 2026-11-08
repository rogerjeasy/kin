import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, jsonb, pgTable, real, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { MAX_SHIFT_MINUTES, PROPOSAL_KINDS } from "@kin/domain";

import { PAYOUT_WALLETS } from "../values.ts";
import { cents, circleId, createdAt, id } from "./columns.ts";
import { circles, members } from "./circles.ts";
import { billState, documentKind, payeeStatus, proposalKind } from "./enums.ts";

/** Someone the circle pays: a company, a caregiver, a shop. */
export const payees = pgTable(
  "payees",
  {
    id: id(),
    circleId: circleId(),
    name: text("name").notNull(),
    /** The spending category the payee's bills are recorded under. */
    category: text("category").notNull(),
    status: payeeStatus("status").notNull().default("new"),
    /** Set when the money goes to a member of the circle. */
    memberId: uuid("member_id"),
    caregiverRateCentsPerHour: cents("caregiver_rate_cents_per_hour"),
    /** Where PayPal sends the money: an email or a PayPal account ID. */
    paypalReceiver: text("paypal_receiver"),
    /** Which wallet the receiver names: a PayPal account, or a Venmo email, phone or handle. */
    payoutWallet: text("payout_wallet", { enum: PAYOUT_WALLETS }).notNull().default("paypal"),
    /** The least a care shift is paid for, in minutes; 0 for none. */
    shiftMinimumMinutes: integer("shift_minimum_minutes").notNull().default(0),
    /** Minutes in one shift paid at the normal rate; the rest are overtime. `null` for no overtime. */
    shiftOvertimeAfterMinutes: integer("shift_overtime_after_minutes"),
    /** The overtime rate as a whole percent of the normal rate. */
    shiftOvertimePercent: integer("shift_overtime_percent").notNull().default(150),
    // A standing rule: the payee is paid without a new approval inside this range.
    autoPayRuleId: text("auto_pay_rule_id"),
    autoPayMinCents: cents("auto_pay_min_cents"),
    autoPayMaxCents: cents("auto_pay_max_cents"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "payees_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "payees_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    unique("payees_circle_row").on(t.circleId, t.id),
    uniqueIndex("payees_one_caregiver_rate").on(t.circleId, t.memberId).where(sql`${t.caregiverRateCentsPerHour} is not null`),
    check("payees_caregiver_rate", sql`${t.caregiverRateCentsPerHour} is null or (${t.memberId} is not null and ${t.caregiverRateCentsPerHour} > 0 and ${t.caregiverRateCentsPerHour} <= 9007199254740991)`),
    check("payees_payout_wallet", sql.raw(`payout_wallet in (${PAYOUT_WALLETS.map((wallet) => `'${wallet}'`).join(", ")})`)),
    // The same limits as the domain's shift pay rules, so no row can hold rules a shift could not be priced by.
    check("payees_shift_rules", sql.raw(`shift_minimum_minutes between 0 and ${MAX_SHIFT_MINUTES} and shift_overtime_percent between 100 and 300 and (shift_overtime_after_minutes is null or shift_overtime_after_minutes between 1 and ${MAX_SHIFT_MINUTES})`)),
    check("payees_name_present", sql`length(trim(${t.name})) > 0`),
    check("payees_category_code", sql`${t.category} ~ '^[a-z0-9_-]+$'`),
    check(
      "payees_auto_pay_complete",
      sql`(${t.autoPayRuleId} is null and ${t.autoPayMinCents} is null and ${t.autoPayMaxCents} is null)
        or (${t.autoPayRuleId} is not null and ${t.autoPayMinCents} > 0 and ${t.autoPayMaxCents} >= ${t.autoPayMinCents})`,
    ),
    check("payees_auto_pay_only_when_approved", sql`${t.autoPayRuleId} is null or ${t.status} = 'approved'`),
  ],
);

/** A file a member gave Kin: a bill, a receipt, a quote. Stored privately in S3. */
export const documents = pgTable(
  "documents",
  {
    id: id(),
    circleId: circleId(),
    kind: documentKind("kind").notNull(),
    /** The S3 key. A demo document has none behind it. */
    storageKey: text("storage_key"),
    contentType: text("content_type"),
    uploadedBy: uuid("uploaded_by"),
    /** What the reading step found, validated against its schema. */
    extraction: jsonb("extraction"),
    confidence: real("confidence"),
    simulated: boolean("simulated").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "documents_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "documents_uploader_fk", columns: [t.circleId, t.uploadedBy], foreignColumns: [members.circleId, members.id] }),
    unique("documents_circle_row").on(t.circleId, t.id),
    // A photograph Kin only read is kept as its reading, not as a file.
    check("documents_stored_or_read", sql`${t.storageKey} is not null or ${t.simulated} or ${t.extraction} is not null`),
    check("documents_confidence_range", sql`${t.confidence} is null or (${t.confidence} >= 0 and ${t.confidence} <= 1)`),
  ],
);

/** A bill the circle has received, from the letter to the payment. */
export const bills = pgTable(
  "bills",
  {
    id: id(),
    circleId: circleId(),
    payeeId: uuid("payee_id").notNull(),
    documentId: uuid("document_id"),
    amountCents: cents("amount_cents").notNull(),
    caregiverDetails: jsonb("caregiver_details"),
    submissionKey: uuid("submission_key"),
    dueOn: date("due_on", { mode: "string" }),
    receivedOn: date("received_on", { mode: "string" }).notNull(),
    state: billState("state").notNull().default("received"),
    /** The earlier bill this one repeats, when it is a duplicate. */
    duplicateOf: uuid("duplicate_of"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "bills_payee_fk", columns: [t.circleId, t.payeeId], foreignColumns: [payees.circleId, payees.id] }),
    foreignKey({ name: "bills_document_fk", columns: [t.circleId, t.documentId], foreignColumns: [documents.circleId, documents.id] }),
    foreignKey({ name: "bills_duplicate_fk", columns: [t.circleId, t.duplicateOf], foreignColumns: [t.circleId, t.id] }),
    unique("bills_circle_row").on(t.circleId, t.id),
    unique("bills_submission_once").on(t.circleId, t.submissionKey),
    check("bills_caregiver_complete", sql`(${t.caregiverDetails} is null) = (${t.submissionKey} is null)`),
    index("bills_payee_idx").on(t.circleId, t.payeeId),
    check("bills_amount_positive", sql`${t.amountCents} > 0`),
    check("bills_duplicate_state", sql`(${t.state} = 'duplicate') = (${t.duplicateOf} is not null)`),
  ],
);

/** A bill the family expects before it arrives, and roughly what it will cost. */
export const expectedBills = pgTable(
  "expected_bills",
  {
    id: id(),
    circleId: circleId(),
    payeeId: uuid("payee_id").notNull(),
    kind: proposalKind("kind").notNull(),
    expectedCents: cents("expected_cents").notNull(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "expected_bills_payee_fk", columns: [t.circleId, t.payeeId], foreignColumns: [payees.circleId, payees.id] }),
    unique("expected_bills_once").on(t.circleId, t.payeeId, t.dueOn),
    check("expected_bills_amount_positive", sql`${t.expectedCents} > 0`),
    check("expected_bills_kind", sql.raw(`kind in (${PROPOSAL_KINDS.filter((kind) => kind !== "member_payout").map((kind) => `'${kind}'`).join(", ")})`)),
  ],
);
