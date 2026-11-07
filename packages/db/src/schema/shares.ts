import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { at, cents, circleId, createdAt, currency, id } from "./columns.ts";
import { circles, members } from "./circles.ts";
import { monthlyShareState } from "./enums.ts";

/**
 * A member's monthly share: the PayPal subscription that pays the pool every
 * month (docs/architecture.md section 8.4). A demo circle's share has no
 * PayPal subscription behind it and is simulated. The ledger holds what was
 * actually charged; this row says what the member committed to and where it
 * stands.
 */
export const monthlyShares = pgTable(
  "monthly_shares",
  {
    id: id(),
    circleId: circleId(),
    memberId: uuid("member_id").notNull(),
    amountCents: cents("amount_cents").notNull(),
    currency: currency(),
    state: monthlyShareState("state").notNull().default("approval_pending"),
    /** PayPal's subscription ID. A simulated share has none. */
    paypalSubscriptionId: text("paypal_subscription_id"),
    /** Where the member approves the subscription on PayPal. Kept so they can come back to it. */
    approvalUrl: text("approval_url"),
    simulated: boolean("simulated").notNull().default(false),
    /** How many charges PayPal has failed, as it last told Kin. */
    failedPayments: integer("failed_payments").notNull().default(0),
    nextBillingAt: at("next_billing_at"),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({ name: "monthly_shares_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "monthly_shares_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    unique("monthly_shares_circle_row").on(t.circleId, t.id),
    unique("monthly_shares_paypal_once").on(t.paypalSubscriptionId),
    // One share at a time per member: a new one starts only after the last is cancelled.
    uniqueIndex("monthly_shares_one_live").on(t.circleId, t.memberId).where(sql`${t.state} <> 'cancelled'`),
    index("monthly_shares_member_idx").on(t.circleId, t.memberId),
    check("monthly_shares_amount_positive", sql`${t.amountCents} > 0 and ${t.amountCents} <= 9007199254740991`),
    check("monthly_shares_simulated_has_no_paypal", sql`${t.simulated} = (${t.paypalSubscriptionId} is null)`),
    check("monthly_shares_failed_count", sql`${t.failedPayments} >= 0`),
  ],
);
