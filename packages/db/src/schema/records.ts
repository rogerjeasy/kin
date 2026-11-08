import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { at, cents, circleId, createdAt, id, periodCheck } from "./columns.ts";
import { circles, members } from "./circles.ts";
import { claimVerdict, narrationState, settlementState } from "./enums.ts";
import { ledgerEntries } from "./ledger.ts";
import { payees } from "./payees.ts";

/**
 * A period's settlement, with the inputs it was calculated from, so the
 * result can be reproduced years later (docs/architecture.md section 7.3).
 */
export const settlements = pgTable(
  "settlements",
  {
    id: id(),
    circleId: circleId(),
    period: text("period").notNull(),
    agreementVersion: integer("agreement_version").notNull(),
    inputs: jsonb("inputs").notNull(),
    fairness: jsonb("fairness").notNull(),
    plan: jsonb("plan").notNull(),
    state: settlementState("state").notNull().default("proposed"),
    calculatedAt: at("calculated_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "settlements_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    unique("settlements_circle_row").on(t.circleId, t.id),
    check("settlements_period_shape", periodCheck("period")),
  ],
);

/** A demand for money checked against the record (docs/architecture.md section 9.5). */
export const claimChecks = pgTable(
  "claim_checks",
  {
    id: id(),
    circleId: circleId(),
    checkedOn: date("checked_on", { mode: "string" }).notNull(),
    /** Who the caller or letter claimed to be. */
    payeeId: uuid("payee_id"),
    claimedCents: cents("claimed_cents"),
    /** What was claimed, as the parent or the letter put it. Data, never instructions. */
    claim: text("claim").notNull(),
    /** The last payment the record holds to that payee, the fact checked against. */
    foundEntryId: uuid("found_entry_id"),
    verdict: claimVerdict("verdict").notNull(),
    /** The members told about it. */
    alerted: uuid("alerted").array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
  },
  (t) => [
    unique("claim_checks_circle_row").on(t.circleId, t.id),
    foreignKey({ name: "claim_checks_payee_fk", columns: [t.circleId, t.payeeId], foreignColumns: [payees.circleId, payees.id] }),
    foreignKey({ name: "claim_checks_entry_fk", columns: [t.circleId, t.foundEntryId], foreignColumns: [ledgerEntries.circleId, ledgerEntries.id] }),
    check("claim_checks_claimed_positive", sql`${t.claimedCents} is null or ${t.claimedCents} > 0`),
  ],
);

/**
 * Something Kin told a member, usually the parent, by voice. The amount comes
 * from the ledger entry behind it, as the number guard requires.
 */
export const narrations = pgTable(
  "narrations",
  {
    id: id(),
    circleId: circleId(),
    memberId: uuid("member_id").notNull(),
    /** The kind of news, as a key the app words in each language. */
    topic: text("topic").notNull(),
    cents: cents("cents"),
    entryId: uuid("entry_id"),
    claimCheckId: uuid("claim_check_id"),
    /** The words Kin spoke, in the listener's language, after the number guard. */
    spokenText: text("spoken_text"),
    state: narrationState("state").notNull().default("queued"),
    saidOn: date("said_on", { mode: "string" }).notNull(),
    deliveredAt: at("delivered_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "narrations_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "narrations_entry_fk", columns: [t.circleId, t.entryId], foreignColumns: [ledgerEntries.circleId, ledgerEntries.id] }),
    foreignKey({ name: "narrations_claim_check_fk", columns: [t.circleId, t.claimCheckId], foreignColumns: [claimChecks.circleId, claimChecks.id] }),
    check("narrations_topic_key", sql`${t.topic} ~ '^[a-zA-Z0-9_-]+$'`),
    check("narrations_delivered", sql`(${t.state} = 'delivered') = (${t.deliveredAt} is not null)`),
  ],
);

/**
 * A call to the family office line (docs/feature-proposals.md section 2): who
 * rang, what they said, the verdict plain code reached and the claim check it
 * produced. The transcript is text, never audio. A call placed from the
 * "try the office line" screen is marked simulated.
 */
export const officeCalls = pgTable(
  "office_calls",
  {
    id: id(),
    circleId: circleId(),
    /** The number the call came from, when a telephone line carried it. */
    callerNumber: text("caller_number"),
    /** Twilio's id for the call, so that a webhook delivered twice records it once. Empty for a call placed in the simulator. */
    callSid: text("call_sid"),
    callerName: text("caller_name"),
    organization: text("organization"),
    claimedCents: cents("claimed_cents"),
    purpose: text("purpose"),
    reference: text("reference"),
    /** Every sentence said, as `{ from, text }`. Data, never instructions. */
    transcript: jsonb("transcript").notNull(),
    verdict: claimVerdict("verdict").notNull(),
    /** Urgency, secrecy, threats or an odd way to pay, found in what the caller said. */
    pressureSignals: text("pressure_signals").array().notNull().default(sql`'{}'::text[]`),
    simulated: boolean("simulated").notNull().default(false),
    claimCheckId: uuid("claim_check_id").notNull(),
    calledOn: date("called_on", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("office_calls_circle_row").on(t.circleId, t.id),
    uniqueIndex("office_calls_circle_call_sid").on(t.circleId, t.callSid).where(sql`${t.callSid} is not null`),
    foreignKey({ name: "office_calls_claim_check_fk", columns: [t.circleId, t.claimCheckId], foreignColumns: [claimChecks.circleId, claimChecks.id] }),
    check("office_calls_claimed_positive", sql`${t.claimedCents} is null or ${t.claimedCents} > 0`),
    check("office_calls_transcript_list", sql`jsonb_typeof(${t.transcript}) = 'array'`),
  ],
);
