import { FEES, entryHeadline, sumCents } from "@kin/domain";
import type { CircleSnapshot } from "@kin/db";

/**
 * Where a set of money facts comes from: all from PayPal's record, all
 * simulated, or some of each. A sentence about money follows this, so a
 * simulated figure is never said to be confirmed by PayPal (AGENTS.md
 * section 5, rule 9).
 */
export type MoneyKind = "paypal" | "simulated" | "mixed";

/**
 * The kind of the facts given. With none to go by, a demo circle's money is
 * simulated and a real circle's is PayPal's.
 */
export function moneyKind(facts: readonly { readonly simulated: boolean }[], demo: boolean): MoneyKind {
  const simulated = facts.filter((fact) => fact.simulated).length;
  if (facts.length === 0) return demo ? "simulated" : "paypal";
  if (simulated === 0) return "paypal";
  return simulated === facts.length ? "simulated" : "mixed";
}

export type PoolProvenance = {
  readonly kind: MoneyKind;
  /** What real PayPal sandbox transactions brought into the pool, the rest being simulated. */
  readonly sandboxInCents: number;
};

/** Where the money in the pool came from: every entry that moved cash in or out of it. */
export function poolProvenance(circle: CircleSnapshot): PoolProvenance {
  const moved = circle.ledger.entries.map((entry) => ({ entry, headline: entryHeadline(entry) })).filter(({ headline }) => headline.poolFlow !== "none");
  const sandboxIn = moved.filter(({ entry, headline }) => !entry.simulated && headline.poolFlow === "in");
  return {
    kind: moneyKind(
      moved.map(({ entry }) => entry),
      circle.circle.demo,
    ),
    sandboxInCents: sumCents(sandboxIn.map(({ headline }) => headline.cents)),
  };
}

/** Whether the period's PayPal fees were charged by PayPal, simulated, or both. */
export function feesKind(circle: CircleSnapshot, period: string): MoneyKind {
  const charged = circle.ledger.entries.filter((entry) => entry.period === period && entry.lines.some((line) => line.account === FEES));
  return moneyKind(charged, circle.circle.demo);
}
