import { sumCents } from "./money.ts";

/** What an entry did to the pool's cash: brought money in, took it out, or neither. */
export type PoolFlow = "in" | "out" | "none";

export type MovementItem = {
  readonly flow: PoolFlow;
  /** The entry's headline amount, always above zero. The flow carries the sign. */
  readonly cents: number;
};

export type MovementTotals = {
  readonly count: number;
  readonly inCents: number;
  readonly outCents: number;
  /** In minus out. Negative when more left the pool than came in. */
  readonly netCents: number;
};

/** The entry's effect on the pool's cash as a signed amount. Care time and approvals move no cash. */
export function poolMovementCents(item: MovementItem): number {
  if (item.flow === "in") return item.cents;
  if (item.flow === "out") return -item.cents;
  return 0;
}

/**
 * What a set of entries did to the pool, from integer cents alone. A
 * reversal is an entry like any other: it flows the opposite way, so it
 * cancels the entry it reverses.
 */
export function movementTotals(items: readonly MovementItem[]): MovementTotals {
  const inCents = sumCents(items.filter((item) => item.flow === "in").map((item) => item.cents));
  const outCents = sumCents(items.filter((item) => item.flow === "out").map((item) => item.cents));
  return { count: items.length, inCents, outCents, netCents: inCents - outCents };
}
