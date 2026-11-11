import { mayUseTool, type RoutedCall } from "@kin/agent";
import type { CircleSnapshot } from "@kin/db";
import { decimalAmount } from "@kin/domain";

import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import type { CircleNames } from "./names";

/** The demand in the suggested scam question: the false gas demand Kin's demo is built around. */
const EXAMPLE_DEMAND_CENTS = 30_000;
const EXAMPLE_PAYEE = "Harbor Gas";

/** A suggested question, and the tool call that answers it, for when Kin must answer without Claude. */
export type Suggestion = { readonly text: string; readonly call: RoutedCall };

/**
 * The questions Ask Kin suggests, each only when the viewer's role may use the
 * tool that answers it, so a suggestion never leads to a refusal.
 */
export function suggestedQuestions(circle: CircleSnapshot, copy: Dictionary["askKin"]["suggestions"], format: Formatters, names: CircleNames): Suggestion[] {
  const caregiver = circle.members.find((member) => member.role === "caregiver" && member.status === "active");
  const asked: { readonly call: RoutedCall; readonly text: string | null }[] = [
    { call: { name: "get_paypal_payout_status", input: caregiver ? { payee: caregiver.displayName } : {} }, text: caregiver ? fill(copy.paid, { caregiver: caregiver.displayName }) : null },
    { call: { name: "get_fairness", input: {} }, text: copy.owes },
    {
      call: { name: "check_claim", input: { payee: EXAMPLE_PAYEE, amount: decimalAmount({ cents: EXAMPLE_DEMAND_CENTS, currency: circle.circle.currency }) } },
      text: fill(copy.demand, { amount: format.money(EXAMPLE_DEMAND_CENTS), payee: EXAMPLE_PAYEE }),
    },
    { call: { name: "propose_refill", input: {} }, text: circle.purchaseRules.length > 0 ? fill(copy.refill, { parent: names.parent }) : null },
  ];
  return asked.flatMap(({ call, text }) => (text !== null && mayUseTool(circle.viewer.role, call.name) ? [{ text, call }] : []));
}

/** The suggested questions' words, as the Ask Kin screen offers them. */
export function askKinSuggestions(circle: CircleSnapshot, copy: Dictionary["askKin"]["suggestions"], format: Formatters, names: CircleNames): string[] {
  return suggestedQuestions(circle, copy, format, names).map((suggestion) => suggestion.text);
}
