import type { CircleSnapshot } from "@kin/db";
import { payoutFeeReserve } from "@kin/paypal";
import { AgreementTermsError, FairnessError, InvalidDecimalError, bpsFromPercent, centsFromDecimal, percentFromBps, simulateScenario, type Scenario, type ScenarioResult } from "@kin/domain";

import { parentLevelOf } from "./members";
import { openPeriod } from "./period";

/** What the what-if form holds, as typed. Absent fields mean "leave as it is". */
export type SimulationInput = {
  /** A share per member, in percent, as typed. */
  readonly shares: Readonly<Record<string, string>>;
  /** The member who stops sharing the cost, or empty. */
  readonly leaving: string;
  /** A bill the pool would pay, as an amount, or empty. */
  readonly bill: string;
};

export type SimulationFailure = "shares" | "amount" | "leaving";
export type SimulationOutcome =
  | { readonly kind: "idle" }
  | { readonly kind: "failed"; readonly reason: SimulationFailure }
  | { readonly kind: "ran"; readonly result: ScenarioResult };

type Query = Readonly<Record<string, string | string[] | undefined>>;

const SHARE_PREFIX = "share.";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));

/** The form as the address holds it. Nothing is trusted: the simulation reads every field again. */
export function inputFromQuery(query: Query): { readonly asked: boolean; readonly input: SimulationInput } {
  const shares = Object.fromEntries(Object.entries(query).filter(([key]) => key.startsWith(SHARE_PREFIX)).map(([key, value]) => [key.slice(SHARE_PREFIX.length), first(value)] as const));
  return { asked: query.run !== undefined, input: { shares, leaving: first(query.leaving), bill: first(query.bill) } };
}

/** The shares the form starts from: the agreement in force, as percentages. */
export function currentShareText(circle: CircleSnapshot): Record<string, string> {
  return Object.fromEntries((circle.agreement?.shares ?? []).map((share) => [share.memberId, percentFromBps(share.bps)]));
}

/**
 * Rehearses the typed what-if on a copy of the circle's real state, with the
 * money core's own functions. Reads the circle and writes nothing: a
 * simulation never saves, proposes or moves money.
 */
export function simulate(circle: CircleSnapshot, input: SimulationInput): SimulationOutcome {
  const agreement = circle.agreement;
  if (agreement === null) return { kind: "idle" };
  try {
    const scenario = scenarioFrom(circle, input);
    const result = simulateScenario({
      ledger: circle.ledger,
      agreement,
      period: openPeriod(circle),
      payoutFee: payoutFeeReserve(circle.circle.currency),
      scenario,
      parentLevel: parentLevelOf(circle),
      pausedUntil: circle.circle.pausedUntil,
      now: circle.circle.now,
    });
    return { kind: "ran", result };
  } catch (error) {
    if (error instanceof InvalidDecimalError) return { kind: "failed", reason: "amount" };
    if (error instanceof AgreementTermsError) return { kind: "failed", reason: "shares" };
    if (error instanceof FairnessError) return { kind: "failed", reason: input.leaving === "" ? "shares" : "leaving" };
    throw error;
  }
}

function scenarioFrom(circle: CircleSnapshot, input: SimulationInput): Scenario {
  const current = circle.agreement?.shares ?? [];
  const typed = current.flatMap((share) => {
    const text = input.shares[share.memberId]?.trim();
    return text === undefined || text === "" ? [] : [{ memberId: share.memberId, bps: bpsFromPercent(text) }];
  });
  const changed = typed.filter((share) => current.find((each) => each.memberId === share.memberId)?.bps !== share.bps);
  const bill = input.bill.trim();
  return {
    // Every typed share is sent, not only the changed ones, so the total is checked as a whole.
    ...(changed.length > 0 ? { shares: typed } : {}),
    ...(input.leaving !== "" ? { leavingMemberId: input.leaving } : {}),
    ...(bill !== "" ? { billCents: centsFromDecimal(bill, circle.circle.currency) } : {}),
  };
}
