import { calculateFairness } from "./fairness.ts";
import type { FairnessInput, FairnessResult } from "./fairness.ts";
import { cashAvailableForPayouts } from "./payout-cash.ts";
import { periodInputs, type PeriodQuery } from "./period-inputs.ts";
import {
  planSettlement,
  type PayoutFunds,
  type SettlementPlan,
} from "./settlement.ts";

export type SettlementQuery = PeriodQuery & Pick<PayoutFunds, "payoutFee">;

/**
 * A period's settlement, with the inputs it was calculated from. Storing the
 * inputs lets the result be reproduced years later.
 */
export type Settlement = {
  readonly period: string;
  readonly agreementVersion: number;
  readonly inputs: FairnessInput;
  readonly fairness: FairnessResult;
  readonly plan: SettlementPlan;
};

/**
 * Closes a period: snapshots the inputs from the ledger, measures every member
 * against the agreement and plans the movements, with payouts bounded by the
 * pool's confirmed cash less the bills it has already promised to pay and
 * PayPal's fee for sending each payout.
 */
export function settlePeriod(query: SettlementQuery): Settlement {
  const inputs = periodInputs(query);
  const fairness = calculateFairness(inputs);
  return {
    period: query.period,
    agreementVersion: query.agreement.version,
    inputs,
    fairness,
    plan: planSettlement(fairness, {
      availableCents: cashAvailableForPayouts(query.ledger),
      payoutFee: query.payoutFee,
    }),
  };
}
