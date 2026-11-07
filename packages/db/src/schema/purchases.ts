import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { at, cents, circleId, createdAt, id } from "./columns.ts";
import { circles } from "./circles.ts";
import { deliveryState } from "./enums.ts";
import { payees } from "./payees.ts";
import { proposals } from "./approvals.ts";

/**
 * What the family allowed Kin to buy for the parent: one approved seller, one
 * item, a limit for each purchase and a budget for the month. Kin proposes
 * only what fits a rule, and a person still confirms each purchase.
 */
export const purchaseRules = pgTable(
  "purchase_rules",
  {
    id: id(),
    circleId: circleId(),
    payeeId: uuid("payee_id").notNull(),
    /** What is bought, as the seller names it. */
    item: text("item").notNull(),
    category: text("category").notNull(),
    /** What the seller charges for one refill now. */
    priceCents: cents("price_cents").notNull(),
    limitCents: cents("limit_cents").notNull(),
    monthlyBudgetCents: cents("monthly_budget_cents").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "purchase_rules_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "purchase_rules_payee_fk", columns: [t.circleId, t.payeeId], foreignColumns: [payees.circleId, payees.id] }),
    unique("purchase_rules_circle_row").on(t.circleId, t.id),
    check("purchase_rules_amounts", sql`${t.priceCents} > 0 and ${t.limitCents} > 0 and ${t.monthlyBudgetCents} > 0`),
    check("purchase_rules_texts_present", sql`length(trim(${t.item})) > 0 and ${t.category} ~ '^[a-zA-Z0-9_-]+$'`),
  ],
);

/**
 * One purchase raised from a rule: its proposal, what it buys and where the
 * order is on its way to the door. The money moves only through the
 * proposal's execution; this row tracks the goods.
 */
export const purchases = pgTable(
  "purchases",
  {
    id: id(),
    circleId: circleId(),
    ruleId: uuid("rule_id").notNull(),
    proposalId: uuid("proposal_id").notNull(),
    item: text("item").notNull(),
    cents: cents("cents").notNull(),
    /** The state of the delivery. `awaiting` until the order is placed. */
    state: deliveryState("state").notNull().default("awaiting"),
    /** The seller's own reference for the order, known once it is placed. */
    merchantOrder: text("merchant_order"),
    orderedAt: at("ordered_at"),
    deliveredAt: at("delivered_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "purchases_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "purchases_rule_fk", columns: [t.circleId, t.ruleId], foreignColumns: [purchaseRules.circleId, purchaseRules.id] }),
    foreignKey({ name: "purchases_proposal_fk", columns: [t.circleId, t.proposalId], foreignColumns: [proposals.circleId, proposals.id] }),
    unique("purchases_circle_row").on(t.circleId, t.id),
    unique("purchases_one_per_proposal").on(t.circleId, t.proposalId),
    index("purchases_rule_idx").on(t.circleId, t.ruleId),
    check("purchases_cents_positive", sql`${t.cents} > 0`),
  ],
);
