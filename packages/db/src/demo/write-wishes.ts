import { calendarDay, type WishRule } from "@kin/domain";
import { randomUUID } from "node:crypto";

import type { Transaction } from "../connection.ts";
import { auditLog, parentSubscriptions, wishSignatures, wishes } from "../schema/index.ts";
import { wishDigest } from "../wishes.ts";
import type { DemoTime } from "./demo-time.ts";
import { ROSES_CIRCLE, type PayeeKey, type PersonaKey } from "./roses-circle.ts";
import { PARENT_SUBSCRIPTIONS, ROSES_WISHES, WISH_WITNESSES_IN_DEMO, type DemoWishRule, type SubscriptionKey } from "./roses-wishes.ts";

type Rows = {
  readonly circleId: string;
  readonly members: Readonly<Record<PersonaKey, string>>;
  readonly payees: Readonly<Record<PayeeKey, string>>;
  readonly time: DemoTime;
};

/**
 * Rose's subscriptions and her wishes in force, each with her confirmation and
 * Elena's and Marcus's witness, sealed by the same digest the database takes
 * when a wish is said in the app. No trigger is open: the visitor reports one.
 */
export async function writeWishes(tx: Transaction, rows: Rows): Promise<void> {
  const { circleId, members, time } = rows;
  const subscriptionIds = Object.fromEntries(PARENT_SUBSCRIPTIONS.map((each) => [each.key, randomUUID()])) as Record<SubscriptionKey, string>;
  await tx.insert(parentSubscriptions).values(
    PARENT_SUBSCRIPTIONS.map((each) => ({ id: subscriptionIds[each.key], circleId, name: each.name, monthlyCents: each.monthlyCents, simulated: true, createdAt: time.at(each.createdAt) })),
  );
  for (const wish of ROSES_WISHES) {
    const id = randomUUID();
    const wishKey = randomUUID();
    const rule = ruleOf(wish.rule, rows, subscriptionIds);
    const saidAt = time.at(wish.saidAt);
    const saidOn = calendarDay(saidAt, ROSES_CIRCLE.timezone).occurredOn;
    const digest = wishDigest({ previousDigest: null, wishKey, version: 1, quote: wish.quote, saidOn, trigger: wish.trigger, rule });
    const inForceAt = time.at(wish.witnessedAt[1]);
    await tx.insert(wishes).values({
      id,
      circleId,
      wishKey,
      version: 1,
      quote: wish.quote,
      saidOn,
      trigger: wish.trigger,
      ruleKind: rule.kind,
      rule,
      recordingId: null,
      state: "in_force",
      digest,
      previousDigest: null,
      simulated: true,
      createdBy: members.rose,
      createdAt: saidAt,
      confirmedAt: saidAt,
      inForceAt,
    });
    await tx.insert(wishSignatures).values([
      { id: randomUUID(), circleId, wishId: id, memberId: members.rose, role: "parent" as const, capacity: "parent" as const, digest, method: "voice" as const, signedAt: saidAt },
      ...WISH_WITNESSES_IN_DEMO.map((witness, index) => ({
        id: randomUUID(),
        circleId,
        wishId: id,
        memberId: members[witness],
        role: witness === "elena" ? ("organizer" as const) : ("contributor" as const),
        capacity: "witness" as const,
        digest,
        method: "app" as const,
        signedAt: time.at(wish.witnessedAt[index] ?? wish.witnessedAt[0]),
      })),
    ]);
    await tx.insert(auditLog).values({
      id: randomUUID(),
      circleId,
      actor: "provisioner",
      action: "wish.in_force",
      subjectType: "wish",
      subjectId: id,
      details: { digest, previousDigest: null, version: 1 },
      origin: "demo",
      at: inForceAt,
    });
  }
}

function ruleOf(rule: DemoWishRule, rows: Rows, subscriptions: Readonly<Record<SubscriptionKey, string>>): WishRule {
  switch (rule.kind) {
    case "keep_paying":
      return { kind: "keep_paying", payeeId: rows.payees[rule.payee] };
    case "pause_discretionary":
      return { kind: "pause_discretionary" };
    case "suspend_subscriptions":
      return { kind: "suspend_subscriptions", subscriptionIds: rule.subscriptions.map((key) => subscriptions[key]) };
    case "new_payee_approvals":
      return { kind: "new_payee_approvals", aboveCents: rule.aboveCents, approverMemberIds: rule.approvers.map((key) => rows.members[key]) };
  }
}
