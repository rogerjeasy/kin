import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, integer, pgTable, unique, uuid } from "drizzle-orm/pg-core";

import { approvalMethod } from "./enums.ts";
import { at, cents, circleId, createdAt, id } from "./columns.ts";
import { circles, members } from "./circles.ts";

/**
 * One version of a circle's agreement. A change is a new version; the old one
 * stays, so every settlement can say which terms it was calculated under.
 */
export const agreements = pgTable(
  "agreements",
  {
    id: id(),
    circleId: circleId(),
    version: integer("version").notNull(),
    /** `null` when the family has not agreed that care hours count. */
    careRateCentsPerHour: cents("care_rate_cents_per_hour"),
    carePaidInCash: boolean("care_paid_in_cash").notNull().default(false),
    ceilingCents: cents("ceiling_cents").notNull(),
    secondApprovalAboveCents: cents("second_approval_above_cents").notNull(),
    parentDecidesAboveCents: cents("parent_decides_above_cents").notNull(),
    effectiveOn: date("effective_on", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "agreements_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    unique("agreements_circle_row").on(t.circleId, t.id),
    unique("agreements_one_per_version").on(t.circleId, t.version),
    check("agreements_version_positive", sql`${t.version} > 0`),
    check("agreements_care_rate", sql`${t.careRateCentsPerHour} is null or ${t.careRateCentsPerHour} > 0`),
    check("agreements_care_cash_needs_rate", sql`not ${t.carePaidInCash} or ${t.careRateCentsPerHour} is not null`),
    check(
      "agreements_thresholds",
      sql`${t.parentDecidesAboveCents} >= 0 and ${t.secondApprovalAboveCents} >= 0 and ${t.ceilingCents} > 0`,
    ),
  ],
);

/** A member's share of the agreement, in basis points. A version's shares total 10 000. */
export const agreementShares = pgTable(
  "agreement_shares",
  {
    id: id(),
    circleId: circleId(),
    agreementId: uuid("agreement_id").notNull(),
    memberId: uuid("member_id").notNull(),
    bps: integer("bps").notNull(),
    /** The order the family wrote the shares in. Screens keep it. */
    position: integer("position").notNull(),
  },
  (t) => [
    foreignKey({ name: "agreement_shares_agreement_fk", columns: [t.circleId, t.agreementId], foreignColumns: [agreements.circleId, agreements.id] }),
    foreignKey({ name: "agreement_shares_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    unique("agreement_shares_one_per_member").on(t.agreementId, t.memberId),
    unique("agreement_shares_position").on(t.agreementId, t.position),
    check("agreement_shares_bps", sql`${t.bps} > 0 and ${t.bps} <= 10000`),
  ],
);

/** A member's acceptance of one version of the agreement. */
export const agreementAcceptances = pgTable(
  "agreement_acceptances",
  {
    id: id(),
    circleId: circleId(),
    agreementId: uuid("agreement_id").notNull(),
    memberId: uuid("member_id").notNull(),
    method: approvalMethod("method").notNull(),
    acceptedAt: at("accepted_at").notNull(),
  },
  (t) => [
    foreignKey({ name: "agreement_acceptances_agreement_fk", columns: [t.circleId, t.agreementId], foreignColumns: [agreements.circleId, agreements.id] }),
    foreignKey({ name: "agreement_acceptances_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    unique("agreement_acceptances_once").on(t.agreementId, t.memberId),
  ],
);
