import type { ToolOutput } from "@kin/agent";

import { refillViews } from "@/content/circle/refills";
import { fill } from "@/i18n/template";

import { runRefill } from "../refills";
import { named, simulatedNote, type AskKinWorld } from "./world";

/** Words of four letters or more, without accents or case: "Rose's refill" → ["rose", "refill"]. */
function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4);
}

/** Words that ask for a refill without naming what to refill. */
const GENERIC_WORDS: ReadonlySet<string> = new Set(["refill", "refills", "reorder", "order", "again", "usual", "please"]);

/**
 * The refill rules the person's words point at. A name that is the rule's own
 * name matches exactly. Words that name no item, a person's name or a word
 * like "refill" ("Rose's refill", or just "Rose"), are no item at all, so they
 * point at every rule, as if no item was named: the circle's only refill, or a
 * question when there are several. Otherwise a rule matches when it shares a
 * word with what was asked ("her prescription" and "Monthly prescription
 * refill"), but only when that leaves exactly one rule: an unclear name is
 * asked about, never guessed.
 */
export function rulesNamed<T extends { readonly rule: { readonly item: string } }>(asked: string | undefined, rules: readonly T[], peoplesNames: readonly string[] = []): T[] {
  const exact = rules.filter((view) => named(asked, view.rule.item));
  if (exact.length > 0 || asked === undefined) return exact;
  const ignored = new Set([...GENERIC_WORDS, ...peoplesNames.flatMap(words)]);
  if (words(asked).every((word) => ignored.has(word))) return [...rules];
  const askedWords = new Set(words(asked).filter((word) => !ignored.has(word)));
  const sharing = rules.filter((view) => words(view.rule.item).some((word) => askedWords.has(word)));
  return sharing.length === 1 ? sharing : [];
}

/**
 * Ask Kin's one tool that does more than read: it raises a refill proposal
 * through the same path as the "Ask Kin to reorder" button. The model may name
 * an item; the rule, its price and the seller come from the record, and the
 * database refuses a plan the agreement does not allow. The refill waits for
 * the yeses the agreement names, unless the parent's standing permission
 * covers it: then it is approved at once and the order is queued. The result
 * says which, so neither the model's words nor the card under them claim a
 * refill waits when it does not. Raised by a member's own assistant under a
 * delegation, it never rides the standing permission: it always waits for a
 * person's yes in Kin.
 */
export async function proposeRefill(world: AskKinWorld, item: string | undefined, delegationId?: string): Promise<ToolOutput> {
  const { format, copy, names } = world;
  const rules = refillViews(world.circle).rules;
  const matching = rulesNamed(item, rules, world.circle.members.map((member) => names.member(member.id)));
  const choices = rules.map((view) => ({ item: view.rule.item, price: format.money(view.rule.priceCents) }));
  const [only] = matching;
  if (only === undefined || matching.length > 1) {
    return { data: { proposed: false, reason: rules.length === 0 ? "no refill rules" : "name one of these items", items: choices }, fact: rules.length === 0 ? copy.facts.refillNone : fill(copy.facts.refillChoose, { items: format.anyOf(choices.map((each) => each.item)) }) };
  }
  const values = { item: only.rule.item, price: format.money(only.rule.priceCents) };
  if (!only.askable) return { data: { proposed: false, reason: "a refill for this item already waits, or the circle is paused", ...values }, fact: fill(copy.facts.refillWaiting, values) };

  const result = await runRefill({ db: world.db, userId: world.userId, circle: world.circle, ...(delegationId === undefined ? {} : { delegationId }) }, { ruleId: only.rule.id });
  if (!result.ok) return { data: { proposed: false, reason: result.reason, ...values }, fact: fill(copy.facts.refillRefused, values) };
  if (result.mandate.outcome === "covered") {
    const covered = { ...values, seller: names.payee(only.rule.payeeId), parent: names.parent };
    return {
      data: {
        proposed: true,
        ...covered,
        // Said plainly, so the model's words agree with the card: nobody is asked, and Kin did not approve it.
        approval: "approved at once by the parent's own standing permission, and the order is being placed: nobody needs to say yes. Kin did not approve it.",
        simulated: world.circle.circle.demo,
      },
      fact: fill(copy.facts.refillCovered, covered) + simulatedNote(world),
      proposal: { id: result.id, standing: { amount: covered.price, seller: covered.seller } },
    };
  }
  return {
    data: {
      proposed: true,
      ...values,
      approval: delegationId === undefined ? "waiting for the yeses the family agreement names: nothing is bought until then" : "waiting for a person's yes in Kin: a refill an outside assistant proposes never uses the standing permission",
      simulated: world.circle.circle.demo,
    },
    fact: fill(copy.facts.refillProposed, values),
    proposal: { id: result.id },
  };
}
