import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { MAX_PURSE_MEMO_CHARS, MAX_PURSE_WORDS_CHARS, PURSE_HOLD_REASONS, PURSE_PAYMENT_STATES, PURSE_ROUTES, PURSE_STATUSES } from "@kin/domain";

import { at, cents, circleId, createdAt, id } from "./columns.ts";
import { circles, members } from "./circles.ts";

const list = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(", ");

/** The kinds of address-book entry: a person, a charity or church, a shop. */
export const PURSE_PAYEE_KINDS = ["person", "charity", "shop"] as const;

/**
 * The parent's Purse and its funding mandate: what the pool moves in each week,
 * the ceiling it never passes and the most one payment may be without a
 * cooling-off. One per circle. Its terms change only through the organizer's
 * operation, which the audit log records with the old and the new terms.
 */
export const purses = pgTable(
  "purses",
  {
    id: id(),
    circleId: circleId(),
    /** The parent whose Purse it is. Only she may spend it. */
    parentMemberId: uuid("parent_member_id").notNull(),
    weeklyCents: cents("weekly_cents").notNull(),
    ceilingCents: cents("ceiling_cents").notNull(),
    perPaymentCents: cents("per_payment_cents").notNull(),
    status: text("status").notNull().default("active"),
    /** The organizer whose decision set the terms now in force. */
    setBy: uuid("set_by").notNull(),
    setAt: at("set_at").notNull(),
    /** A demo circle's Purse moves simulated money only, and says so. */
    simulated: boolean("simulated").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "purses_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "purses_parent_fk", columns: [t.circleId, t.parentMemberId], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "purses_set_by_fk", columns: [t.circleId, t.setBy], foreignColumns: [members.circleId, members.id] }),
    unique("purses_circle_row").on(t.circleId, t.id),
    unique("purses_one_per_circle").on(t.circleId),
    check("purses_status", sql.raw(`status in (${list(PURSE_STATUSES)})`)),
    check("purses_terms", sql`${t.weeklyCents} > 0 and ${t.ceilingCents} > 0 and ${t.perPaymentCents} > 0 and ${t.weeklyCents} <= ${t.ceilingCents} and ${t.perPaymentCents} <= ${t.ceilingCents}`),
  ],
);

/**
 * The people and places she may pay without a cooling-off: added once, by her
 * or the family, and verified by a family member who did not add them. Once
 * added, an entry's address never changes: a new address is a new entry,
 * verified again.
 */
export const pursePayees = pgTable(
  "purse_payees",
  {
    id: id(),
    circleId: circleId(),
    name: text("name").notNull(),
    /** How the payee is related to her, in the family's own words: "granddaughter", "her church". */
    relationship: text("relationship").notNull(),
    kind: text("kind").notNull(),
    /** Other ways she says the name, so "Lil" finds Lily. */
    aliases: text("aliases").array().notNull().default(sql`'{}'`),
    /** Where PayPal sends the money: the payee's PayPal email. Fixed for the life of the entry. */
    paypalReceiver: text("paypal_receiver").notNull(),
    addedBy: uuid("added_by").notNull(),
    verifiedBy: uuid("verified_by"),
    verifiedAt: at("verified_at"),
    removedAt: at("removed_at"),
    /** A demo circle's address book is a stand-in: nobody real is ever paid. */
    simulated: boolean("simulated").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "purse_payees_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "purse_payees_added_by_fk", columns: [t.circleId, t.addedBy], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "purse_payees_verified_by_fk", columns: [t.circleId, t.verifiedBy], foreignColumns: [members.circleId, members.id] }),
    unique("purse_payees_circle_row").on(t.circleId, t.id),
    uniqueIndex("purse_payees_one_name").on(t.circleId, sql`lower(${t.name})`).where(sql`${t.removedAt} is null`),
    check("purse_payees_name", sql`length(btrim(${t.name})) between 1 and 80`),
    check("purse_payees_relationship", sql`length(btrim(${t.relationship})) between 1 and 80`),
    check("purse_payees_kind", sql.raw(`kind in (${list(PURSE_PAYEE_KINDS)})`)),
    check("purse_payees_aliases", sql`cardinality(${t.aliases}) <= 5 and length(array_to_string(${t.aliases}, '')) <= 200`),
    check("purse_payees_receiver", sql`${t.paypalReceiver} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$' and length(${t.paypalReceiver}) <= 254`),
    check("purse_payees_verified", sql`(${t.verifiedBy} is null) = (${t.verifiedAt} is null) and (${t.verifiedBy} is null or ${t.verifiedBy} <> ${t.addedBy})`),
  ],
);

/**
 * One payment she asked for, from the words she said to PayPal's record. The
 * family sees a row only with her consent (`shared_at`) or when it raised a
 * flag (`held_at`): row-level security, not the screen, keeps the rest hers.
 * What she asked for never changes once it is read back; only its state, her
 * answer, the hold and the payment's progress move.
 */
export const pursePayments = pgTable(
  "purse_payments",
  {
    id: id(),
    circleId: circleId(),
    purseId: uuid("purse_id").notNull(),
    /** The address-book entry it goes to, or `null` for someone not in it. */
    payeeId: uuid("payee_id"),
    /** Who it is for: the entry's name, or the name as she said it. */
    payeeName: text("payee_name").notNull(),
    cents: cents("cents").notNull(),
    memo: text("memo"),
    /** What she said or typed, kept as data. */
    words: text("words").notNull(),
    /** How the model read the way she wants to pay, when it read it. */
    route: text("route"),
    /** The scam markers plain code found in her words. */
    markers: text("markers").array().notNull().default(sql`'{}'`),
    /** Every reason it must wait, decided by plain code. Empty for a payment that goes on her yes. */
    holdReasons: text("hold_reasons").array().notNull().default(sql`'{}'`),
    /** The sentence Kin read back to her, after the number guard. */
    readBack: text("read_back").notNull(),
    /** Whether Claude worded the read-back or Kin's fixed template did. */
    readBackSource: text("read_back_source").notNull(),
    state: text("state").notNull().default("proposed"),
    proposedAt: at("proposed_at").notNull(),
    /** The latest moment her yes is taken. */
    expiresAt: at("expires_at").notNull(),
    /** Her answer: the recorded approval of the payment. */
    answeredAt: at("answered_at"),
    answerMethod: text("answer_method"),
    /** What she said in answer, or that she tapped. */
    answerEvidence: text("answer_evidence"),
    heldAt: at("held_at"),
    holdEndsAt: at("hold_ends_at"),
    cancelledAt: at("cancelled_at"),
    cancelledBy: uuid("cancelled_by"),
    /** She stopped it herself because, as she told Kin, someone was telling her what to do. The family is shown this. */
    pressured: boolean("pressured").notNull().default(false),
    /** Her recorded consent for the family to see this payment. */
    sharedAt: at("shared_at"),
    /** PayPal sees this as the batch ID, so the payment is made at most once. */
    idempotencyKey: text("idempotency_key").notNull(),
    /** The address fixed when it was approved: the payee's, and no other. */
    receiver: text("receiver"),
    paypalBatchId: text("paypal_batch_id"),
    paypalItemId: text("paypal_item_id"),
    feeCents: cents("fee_cents"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    submittedAt: at("submitted_at"),
    paidAt: at("paid_at"),
    /** When the nightly reconciliation found the payment in PayPal's Transaction Search. */
    reconciledAt: at("reconciled_at"),
    simulated: boolean("simulated").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "purse_payments_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "purse_payments_purse_fk", columns: [t.circleId, t.purseId], foreignColumns: [purses.circleId, purses.id] }),
    foreignKey({ name: "purse_payments_payee_fk", columns: [t.circleId, t.payeeId], foreignColumns: [pursePayees.circleId, pursePayees.id] }),
    foreignKey({ name: "purse_payments_cancelled_by_fk", columns: [t.circleId, t.cancelledBy], foreignColumns: [members.circleId, members.id] }),
    unique("purse_payments_circle_row").on(t.circleId, t.id),
    unique("purse_payments_key").on(t.idempotencyKey),
    index("purse_payments_state_idx").on(t.circleId, t.state),
    check("purse_payments_cents", sql`${t.cents} > 0`),
    check("purse_payments_state", sql.raw(`state in (${list(PURSE_PAYMENT_STATES)})`)),
    check("purse_payments_route", sql.raw(`route is null or route in (${list(PURSE_ROUTES)})`)),
    check("purse_payments_reasons", sql.raw(`hold_reasons <@ array[${list(PURSE_HOLD_REASONS)}]::text[]`)),
    check("purse_payments_texts", sql.raw(`length(btrim(payee_name)) between 1 and 80 and length(words) between 1 and ${MAX_PURSE_WORDS_CHARS} and (memo is null or length(memo) between 1 and ${MAX_PURSE_MEMO_CHARS}) and length(read_back) between 1 and 600`)),
    check("purse_payments_read_back_source", sql`${t.readBackSource} in ('model', 'template')`),
    check("purse_payments_answer", sql`(${t.answeredAt} is null) = (${t.answerMethod} is null) and (${t.answerMethod} is null or ${t.answerMethod} in ('app', 'voice'))`),
    check("purse_payments_hold", sql`(${t.heldAt} is null) = (${t.holdEndsAt} is null) and (${t.heldAt} is null or cardinality(${t.holdReasons}) > 0)`),
    check("purse_payments_cancelled", sql`(${t.cancelledAt} is null) = (${t.cancelledBy} is null) and (not ${t.pressured} or ${t.cancelledAt} is not null)`),
    check("purse_payments_paid", sql`(${t.state} = 'paid') = (${t.paidAt} is not null)`),
  ],
);
