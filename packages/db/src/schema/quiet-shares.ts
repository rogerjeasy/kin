import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { MAX_ASK_CENTS, MAX_ASK_TITLE, MAX_CARE_MINUTES, MAX_CARE_TRIPS, MAX_OFFER_CENTS, MAX_OFFER_SEALS, QUIET_PART_METHODS, QUIET_SHARE_KINDS, QUIET_SHARE_STATES, SPREAD_MONTHS } from "@kin/domain";

import { agreements } from "./agreements.ts";
import { at, cents, circleId, createdAt, id, periodCheck } from "./columns.ts";
import { circles, members } from "./circles.ts";
import { bills } from "./payees.ts";

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
const MONTH_OR_NULL = (column: string) => sql.raw(`${column} is null or ${column} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`);

/**
 * A cost the family covers together with quiet shares: the stairlift the pool
 * cannot pay, or a rise in the monthly budget. Everyone who sees the circle's
 * money reads it: what it costs, where it stands, how many have answered and,
 * if the offers fall short, by how much. Nobody's limit is here.
 */
export const quietShareAsks = pgTable(
  "quiet_share_asks",
  {
    id: id(),
    circleId: circleId(),
    title: text("title").notNull(),
    kind: text("kind", { enum: QUIET_SHARE_KINDS }).notNull(),
    costCents: cents("cost_cents").notNull(),
    /** The bill the ask covers, when there is one. */
    billId: uuid("bill_id"),
    /** The agreement whose shares the mediator uses, fixed when the ask is raised. */
    agreementId: uuid("agreement_id").notNull(),
    /** Who is asked: the members holding a share in that agreement. */
    asked: uuid("asked").array().notNull(),
    /** The first month on the circle's clock, as YYYY-MM. */
    startMonth: text("start_month").notNull(),
    months: integer("months").notNull().default(1),
    state: text("state", { enum: QUIET_SHARE_STATES }).notNull().default("gathering"),
    /** How many times the mediator has run: the parts of the latest round are the plan. */
    round: integer("round").notNull().default(0),
    answeredCount: integer("answered_count").notNull().default(0),
    /** The parts that need their person's yes, and how many have it. */
    partCount: integer("part_count").notNull().default(0),
    acceptedCount: integer("accepted_count").notNull().default(0),
    shortfallCents: cents("shortfall_cents"),
    spreadWouldCover: boolean("spread_would_cover"),
    payLaterUsed: boolean("pay_later_used").notNull().default(false),
    /** An ask in a demo circle is simulated, and its PayPal actions are too. */
    simulated: boolean("simulated").notNull(),
    raisedBy: uuid("raised_by").notNull(),
    createdAt: createdAt(),
    decidedAt: at("decided_at"),
  },
  (t) => [
    foreignKey({ name: "quiet_share_asks_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "quiet_share_asks_bill_fk", columns: [t.circleId, t.billId], foreignColumns: [bills.circleId, bills.id] }),
    foreignKey({ name: "quiet_share_asks_agreement_fk", columns: [t.circleId, t.agreementId], foreignColumns: [agreements.circleId, agreements.id] }),
    foreignKey({ name: "quiet_share_asks_raised_by_fk", columns: [t.circleId, t.raisedBy], foreignColumns: [members.circleId, members.id] }),
    unique("quiet_share_asks_circle_row").on(t.circleId, t.id),
    index("quiet_share_asks_state_idx").on(t.circleId, t.state),
    check("quiet_share_asks_title", sql.raw(`char_length(title) between 1 and ${MAX_ASK_TITLE} and title !~ '[<>[:cntrl:]]' and title = btrim(title)`)),
    check("quiet_share_asks_kind", sql.raw(`kind in (${quoted(QUIET_SHARE_KINDS)})`)),
    check("quiet_share_asks_state", sql.raw(`state in (${quoted(QUIET_SHARE_STATES)})`)),
    check("quiet_share_asks_cost", sql.raw(`cost_cents > 0 and cost_cents <= ${MAX_ASK_CENTS}`)),
    check("quiet_share_asks_month", periodCheck("start_month")),
    check("quiet_share_asks_months", sql.raw(`months = 1 or (months = ${SPREAD_MONTHS} and kind = 'one_off')`)),
    check("quiet_share_asks_asked", sql`cardinality(${t.asked}) between 1 and 12`),
    check("quiet_share_asks_counts", sql`${t.answeredCount} between 0 and cardinality(${t.asked}) and ${t.acceptedCount} between 0 and ${t.partCount} and ${t.round} >= 0`),
    check("quiet_share_asks_shortfall", sql`${t.shortfallCents} is null or ${t.shortfallCents} between 0 and ${t.costCents}`),
  ],
);

/**
 * What one person said they can give, as they confirmed it. Only its author
 * reads it: not the organizer, not an observer, not Kin's service. The
 * mediator reads it as the database's owner and hands back only parts. The
 * words it came from are never stored.
 */
export const sealedOffers = pgTable(
  "sealed_offers",
  {
    id: id(),
    circleId: circleId(),
    askId: uuid("ask_id").notNull(),
    memberId: uuid("member_id").notNull(),
    monthlyCents: cents("monthly_cents").notNull(),
    stepUpCents: cents("step_up_cents"),
    stepUpFrom: text("step_up_from"),
    careTrips: integer("care_trips").notNull().default(0),
    careMinutes: integer("care_minutes").notNull().default(0),
    earliestMonth: text("earliest_month"),
    /** The person chose to take the family's gap on with PayPal Pay Later. */
    takesShortfall: boolean("takes_shortfall").notNull().default(false),
    /** How many times the person has sealed it. */
    seals: integer("seals").notNull().default(1),
    sealedAt: at("sealed_at").notNull(),
  },
  (t) => [
    foreignKey({ name: "sealed_offers_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "sealed_offers_ask_fk", columns: [t.circleId, t.askId], foreignColumns: [quietShareAsks.circleId, quietShareAsks.id] }),
    foreignKey({ name: "sealed_offers_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    unique("sealed_offers_one_per_member").on(t.askId, t.memberId),
    check("sealed_offers_amount", sql.raw(`monthly_cents between 0 and ${MAX_OFFER_CENTS}`)),
    check("sealed_offers_step_up", sql.raw(`(step_up_cents is null) = (step_up_from is null) and (step_up_cents is null or (step_up_cents > monthly_cents and step_up_cents <= ${MAX_OFFER_CENTS}))`)),
    check("sealed_offers_step_up_month", MONTH_OR_NULL("step_up_from")),
    check("sealed_offers_earliest_month", MONTH_OR_NULL("earliest_month")),
    check("sealed_offers_care", sql.raw(`care_minutes between 0 and ${MAX_CARE_MINUTES} and care_trips between 0 and ${MAX_CARE_TRIPS}`)),
    check("sealed_offers_seals", sql.raw(`seals between 1 and ${MAX_OFFER_SEALS}`)),
  ],
);

/**
 * One person's part of a plan, written by the mediator for each round. Only
 * its person reads it. Its figures never change; only the person's yes, the
 * way they will pay and the PayPal action prepared for it are added.
 */
export const quietShareParts = pgTable(
  "quiet_share_parts",
  {
    id: id(),
    circleId: circleId(),
    askId: uuid("ask_id").notNull(),
    memberId: uuid("member_id").notNull(),
    round: integer("round").notNull(),
    cents: cents("cents").notNull(),
    perMonth: bigint("per_month", { mode: "number" }).array().notNull(),
    payLaterCents: cents("pay_later_cents").notNull(),
    atLimit: boolean("at_limit").notNull(),
    shareCents: cents("share_cents").notNull(),
    careTrips: integer("care_trips").notNull(),
    careMinutes: integer("care_minutes").notNull(),
    careValueCents: cents("care_value_cents").notNull(),
    acceptedAt: at("accepted_at"),
    method: text("method", { enum: QUIET_PART_METHODS }),
    preparedAt: at("prepared_at"),
    /** PayPal's own reference for the prepared action, and the page the person approves it on. */
    paypalRef: text("paypal_ref"),
    approvalUrl: text("approval_url"),
  },
  (t) => [
    foreignKey({ name: "quiet_share_parts_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "quiet_share_parts_ask_fk", columns: [t.circleId, t.askId], foreignColumns: [quietShareAsks.circleId, quietShareAsks.id] }),
    foreignKey({ name: "quiet_share_parts_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    unique("quiet_share_parts_one_per_round").on(t.askId, t.round, t.memberId),
    check("quiet_share_parts_amounts", sql`${t.cents} >= 0 and ${t.payLaterCents} between 0 and ${t.cents} and ${t.shareCents} >= 0 and ${t.careValueCents} >= 0`),
    check("quiet_share_parts_method", sql.raw(`method is null or method in (${quoted(QUIET_PART_METHODS)})`)),
    check("quiet_share_parts_accepted", sql`(${t.method} is null) = (${t.acceptedAt} is null) and (${t.preparedAt} is null or ${t.acceptedAt} is not null)`),
    check("quiet_share_parts_approval_url", sql`${t.approvalUrl} is null or ${t.approvalUrl} ~ '^https://([a-z0-9-]+\\.)*paypal\\.com/'`),
  ],
);
