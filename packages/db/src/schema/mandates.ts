import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { at, cents, circleId, createdAt, id, periodCheck } from "./columns.ts";
import { circles, members } from "./circles.ts";
import { mandateStatus } from "./enums.ts";
import { proposals } from "./approvals.ts";
import { purchaseRules } from "./purchases.ts";

/**
 * The parent's standing permission for one refill rule: a limit for each
 * purchase and for each period, between two dates. Its terms are fixed once
 * granted; only its status moves, and a revoked mandate never returns. The
 * database seals the terms with a digest so the record shows what was read back.
 */
export const mandates = pgTable(
  "mandates",
  {
    id: id(),
    circleId: circleId(),
    ruleId: uuid("rule_id").notNull(),
    /** The parent whose permission it is. */
    grantedBy: uuid("granted_by").notNull(),
    /** Who recorded it: the parent, or in a demo circle the organizer playing the parent's spoken yes. */
    recordedBy: uuid("recorded_by").notNull(),
    perPurchaseCents: cents("per_purchase_cents").notNull(),
    perPeriodCents: cents("per_period_cents").notNull(),
    cadence: text("cadence").notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    expiresOn: date("expires_on", { mode: "string" }).notNull(),
    status: mandateStatus("status").notNull().default("active"),
    /** The words the parent spoke, as written down, or `null` when she used the screen. */
    spokenText: text("spoken_text"),
    /** What proves the grant: the call, or the demo's stand-in. */
    evidenceRef: text("evidence_ref").notNull(),
    /** A grant made in a demo circle is simulated, and shown so. */
    simulated: boolean("simulated").notNull(),
    /** SHA-256 of the canonical terms, computed by the database when it was granted. */
    digest: text("digest").notNull(),
    grantedAt: at("granted_at").notNull(),
    endedAt: at("ended_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "mandates_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "mandates_rule_fk", columns: [t.circleId, t.ruleId], foreignColumns: [purchaseRules.circleId, purchaseRules.id] }),
    foreignKey({ name: "mandates_granted_by_fk", columns: [t.circleId, t.grantedBy], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "mandates_recorded_by_fk", columns: [t.circleId, t.recordedBy], foreignColumns: [members.circleId, members.id] }),
    unique("mandates_circle_row").on(t.circleId, t.id),
    index("mandates_rule_idx").on(t.circleId, t.ruleId),
    check("mandates_caps", sql`${t.perPurchaseCents} > 0 and ${t.perPeriodCents} >= ${t.perPurchaseCents}`),
    check("mandates_cadence", sql`${t.cadence} in ('monthly', 'as_needed')`),
    check("mandates_dates", sql`${t.expiresOn} > ${t.validFrom} and ${t.expiresOn} - ${t.validFrom} <= 366`),
    check("mandates_ended_when_revoked", sql`(${t.status} = 'revoked') = (${t.endedAt} is not null)`),
  ],
);

/**
 * One purchase made under a mandate: which proposal, what it cost and in which
 * period. The period's total is what the next purchase is checked against.
 */
export const mandateUses = pgTable(
  "mandate_uses",
  {
    id: id(),
    circleId: circleId(),
    mandateId: uuid("mandate_id").notNull(),
    proposalId: uuid("proposal_id").notNull(),
    cents: cents("cents").notNull(),
    /** The circle's month, YYYY-MM, in its own timezone. */
    period: text("period").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "mandate_uses_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "mandate_uses_mandate_fk", columns: [t.circleId, t.mandateId], foreignColumns: [mandates.circleId, mandates.id] }),
    foreignKey({ name: "mandate_uses_proposal_fk", columns: [t.circleId, t.proposalId], foreignColumns: [proposals.circleId, proposals.id] }),
    unique("mandate_uses_circle_row").on(t.circleId, t.id),
    unique("mandate_uses_one_per_proposal").on(t.circleId, t.proposalId),
    index("mandate_uses_period_idx").on(t.circleId, t.mandateId, t.period),
    check("mandate_uses_cents_positive", sql`${t.cents} > 0`),
    check("mandate_uses_period", periodCheck("period")),
  ],
);
