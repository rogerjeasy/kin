import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { CARE_END_TERMS, CARE_PAYERS, CARE_RELATIONS, MAX_DUTIES, MAX_DUTY_CHARS, MAX_WEEKLY_MINUTES, SIGNING_CAPACITIES, US_STATES } from "@kin/domain";

import { at, cents, circleId, createdAt, id } from "./columns.ts";
import { circles, members } from "./circles.ts";
import { approvalMethod } from "./enums.ts";
import { payees } from "./payees.ts";

/** A draft waits for signatures and, once signed, governs; a withdrawn one never does. */
export const CARE_AGREEMENT_STATES = ["draft", "withdrawn"] as const;

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * The separator and the one duty's pattern, for the check that holds the list of duties to the domain's rules without a
 * function: 1 to MAX_DUTIES items, each 1 to MAX_DUTY_CHARS characters, with no `<` or `>`, and none that begins or ends in a space.
 */
const DUTY = String.raw`[^<>\x01\s]([^<>\x01]{0,${MAX_DUTY_CHARS - 2}}[^<>\x01\s])?`;
const DUTIES_SHAPE = String.raw`^${DUTY}(\x01${DUTY}){0,${MAX_DUTIES - 1}}$`;

/**
 * The written agreement between the person who needs care, or the organizer
 * acting for them, and the caregiver. Its terms are fixed when it is written:
 * a change is a new agreement. Only its state (a draft may be withdrawn, never
 * the other way) and the day the family ended it, once, ever move. Whether it
 * governs is decided by the signatures beside it, by plain code in
 * packages/domain; the database holds the same rules a second time.
 */
export const careAgreements = pgTable(
  "care_agreements",
  {
    id: id(),
    circleId: circleId(),
    /** The caregiver's payee row: the agreement governs what the pool pays it. */
    payeeId: uuid("payee_id").notNull(),
    caregiverMemberId: uuid("caregiver_member_id").notNull(),
    caregiverRelation: text("caregiver_relation", { enum: CARE_RELATIONS }).notNull(),
    duties: text("duties").array().notNull(),
    weeklyMinutes: integer("weekly_minutes").notNull(),
    rateCentsPerHour: cents("rate_cents_per_hour").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endTerm: text("end_term", { enum: CARE_END_TERMS }).notNull(),
    endsOn: date("ends_on", { mode: "string" }),
    payer: text("payer", { enum: CARE_PAYERS }).notNull(),
    /** The state whose law the family named. */
    usState: text("us_state", { enum: US_STATES }).notNull(),
    state: text("state", { enum: CARE_AGREEMENT_STATES }).notNull().default("draft"),
    /** The last day the agreement covers when the family ended it early. */
    endedOn: date("ended_on", { mode: "string" }),
    /** An agreement written in a demo circle is simulated, and shown so. */
    simulated: boolean("simulated").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "care_agreements_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "care_agreements_payee_fk", columns: [t.circleId, t.payeeId], foreignColumns: [payees.circleId, payees.id] }),
    foreignKey({ name: "care_agreements_caregiver_fk", columns: [t.circleId, t.caregiverMemberId], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "care_agreements_created_by_fk", columns: [t.circleId, t.createdBy], foreignColumns: [members.circleId, members.id] }),
    unique("care_agreements_circle_row").on(t.circleId, t.id),
    index("care_agreements_payee_idx").on(t.circleId, t.payeeId),
    // An agreement with a spouse does not help for Medicaid spend-down, so the database refuses to hold one, as the domain refuses to draft one.
    check("care_agreements_relation", sql.raw(`caregiver_relation in (${quoted(CARE_RELATIONS.filter((relation) => relation !== "spouse"))})`)),
    check("care_agreements_duties", sql.raw(`array_ndims(duties) = 1 and array_position(duties, null) is null and array_to_string(duties, E'\\x01') ~ '${DUTIES_SHAPE}'`)),
    check("care_agreements_hours", sql.raw(`weekly_minutes between 1 and ${MAX_WEEKLY_MINUTES}`)),
    check("care_agreements_rate", sql`${t.rateCentsPerHour} > 0 and ${t.rateCentsPerHour} <= 1000000`),
    check("care_agreements_end_term", sql.raw(`end_term in (${quoted(CARE_END_TERMS)})`)),
    check("care_agreements_fixed_end", sql`(${t.endTerm} = 'fixed_end_date') = (${t.endsOn} is not null) and (${t.endsOn} is null or ${t.endsOn} > ${t.startsOn})`),
    check("care_agreements_payer", sql.raw(`payer in (${quoted(CARE_PAYERS)})`)),
    check("care_agreements_us_state", sql.raw(`us_state in (${quoted(US_STATES)})`)),
    check("care_agreements_state", sql.raw(`state in (${quoted(CARE_AGREEMENT_STATES)})`)),
    // Only an agreement that was never withdrawn is ended early, and not before it began.
    check("care_agreements_ended", sql`${t.endedOn} is null or (${t.state} = 'draft' and ${t.endedOn} >= ${t.startsOn})`),
  ],
);

/**
 * A signature on a care agreement: the caregiver's, and the care recipient's
 * or the organizer's on their behalf. Written once, never changed, on the
 * calendar day the circle's clock showed.
 */
export const careAgreementSignatures = pgTable(
  "care_agreement_signatures",
  {
    id: id(),
    circleId: circleId(),
    agreementId: uuid("agreement_id").notNull(),
    memberId: uuid("member_id").notNull(),
    capacity: text("capacity", { enum: SIGNING_CAPACITIES }).notNull(),
    method: approvalMethod("method").notNull(),
    /** The circle's calendar day, which is what the agreement's coverage counts from. */
    signedOn: date("signed_on", { mode: "string" }).notNull(),
    signedAt: at("signed_at").notNull(),
  },
  (t) => [
    foreignKey({ name: "care_agreement_signatures_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "care_agreement_signatures_agreement_fk", columns: [t.circleId, t.agreementId], foreignColumns: [careAgreements.circleId, careAgreements.id] }),
    foreignKey({ name: "care_agreement_signatures_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    unique("care_agreement_signatures_one_per_capacity").on(t.agreementId, t.capacity),
    unique("care_agreement_signatures_one_per_member").on(t.agreementId, t.memberId),
    check("care_agreement_signatures_capacity", sql.raw(`capacity in (${quoted(SIGNING_CAPACITIES)})`)),
  ],
);
