import type { Money } from "./money.ts";
import { checkTopUp, type TopUpCheck } from "./top-up.ts";

/**
 * A member's monthly share: a PayPal subscription that pays the pool every
 * month. Its states follow what PayPal says (docs/architecture.md section
 * 8.4): a share waits for the member to approve it on PayPal, runs, may be
 * paused and resumed, and ends for good when cancelled. A cancelled share is
 * never reopened: a member who wants one again starts a new share.
 */
export const MONTHLY_SHARE_TRANSITIONS = {
  approval_pending: ["active", "cancelled"],
  active: ["paused", "cancelled"],
  paused: ["active", "cancelled"],
  cancelled: [],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type MonthlyShareState = keyof typeof MONTHLY_SHARE_TRANSITIONS;

export const MONTHLY_SHARE_STATES = Object.keys(MONTHLY_SHARE_TRANSITIONS) as [MonthlyShareState, ...MonthlyShareState[]];

/** Whether a share may move from one state to another. Staying put is not a move. */
export function monthlyShareMayMove(from: MonthlyShareState, to: MonthlyShareState): boolean {
  return (MONTHLY_SHARE_TRANSITIONS[from] as readonly MonthlyShareState[]).includes(to);
}

/** A share counts toward the circle while it waits, runs or is paused; only a cancelled one is over. */
export function monthlyShareIsLive(state: MonthlyShareState): boolean {
  return state !== "cancelled";
}

/** Whether `amount` is one a member may commit to every month: the same limits as a top-up. */
export function checkMonthlyShare(amount: Money): TopUpCheck {
  return checkTopUp(amount);
}
