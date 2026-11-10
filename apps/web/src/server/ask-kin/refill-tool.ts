import type { ToolOutput } from "@kin/agent";

import { refillViews } from "@/content/circle/refills";
import { fill } from "@/i18n/template";

import { runRefill } from "../refills";
import { named, type AskKinWorld } from "./world";

/**
 * Ask Kin's one tool that does more than read: it raises a refill proposal
 * through the same path as the "Ask Kin to reorder" button. The model may name
 * an item; the rule, its price and the seller come from the record, and the
 * database refuses a plan the agreement does not allow. Nothing is bought:
 * the refill waits for the yeses the agreement names, unless the parent's
 * standing permission covers it. Raised by a member's own assistant under a
 * delegation, it never rides the standing permission: it always waits for a
 * person's yes in Kin.
 */
export async function proposeRefill(world: AskKinWorld, item: string | undefined, delegationId?: string): Promise<ToolOutput> {
  const { format, copy } = world;
  const rules = refillViews(world.circle).rules;
  const matching = rules.filter((view) => named(item, view.rule.item));
  const choices = rules.map((view) => ({ item: view.rule.item, price: format.money(view.rule.priceCents) }));
  const [only] = matching;
  if (only === undefined || matching.length > 1) {
    return { data: { proposed: false, reason: rules.length === 0 ? "no refill rules" : "name one of these items", items: choices }, fact: rules.length === 0 ? copy.facts.refillNone : fill(copy.facts.refillChoose, { items: format.anyOf(choices.map((each) => each.item)) }) };
  }
  const values = { item: only.rule.item, price: format.money(only.rule.priceCents) };
  if (!only.askable) return { data: { proposed: false, reason: "a refill for this item already waits, or the circle is paused", ...values }, fact: fill(copy.facts.refillWaiting, values) };

  const result = await runRefill({ db: world.db, userId: world.userId, circle: world.circle, ...(delegationId === undefined ? {} : { delegationId }) }, { ruleId: only.rule.id });
  if (!result.ok) return { data: { proposed: false, reason: result.reason, ...values }, fact: fill(copy.facts.refillRefused, values) };
  const covered = result.mandate.outcome === "covered";
  return {
    data: {
      proposed: true,
      ...values,
      approval: covered ? "the parent's standing permission covers it" : delegationId === undefined ? "waits for the yeses the family agreement names" : "waits for a person's yes in Kin: a refill an outside assistant proposes never uses the standing permission",
      simulated: world.circle.circle.demo,
    },
    fact: fill(covered ? copy.facts.refillCovered : copy.facts.refillProposed, values),
    proposal: { id: result.id },
  };
}
