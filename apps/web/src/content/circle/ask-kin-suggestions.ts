import { mayUseTool, type AskKinToolName } from "@kin/agent";
import type { CircleSnapshot } from "@kin/db";

import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import type { CircleNames } from "./names";

/** The demand in the suggested scam question: the false gas demand Kin's demo is built around. */
const EXAMPLE_DEMAND_CENTS = 30_000;

const isRealTopUp = (entry: CircleSnapshot["ledger"]["entries"][number]) => entry.kind === "contribution" && entry.reverses === null && !entry.simulated && entry.source.type === "paypal_event";

/**
 * The questions Ask Kin suggests, each only when the viewer's role may use the
 * tool that answers it, so a suggestion never leads to a refusal.
 */
export function askKinSuggestions(circle: CircleSnapshot, copy: Dictionary["askKin"]["suggestions"], format: Formatters, names: CircleNames): string[] {
  const caregiver = circle.members.find((member) => member.role === "caregiver" && member.status === "active");
  const asked: { readonly tool: AskKinToolName; readonly text: string | null }[] = [
    { tool: "get_paypal_payout_status", text: caregiver ? fill(copy.paid, { caregiver: caregiver.displayName }) : null },
    { tool: "get_fairness", text: copy.owes },
    { tool: "check_claim", text: fill(copy.demand, { amount: format.money(EXAMPLE_DEMAND_CENTS) }) },
    { tool: "propose_refill", text: circle.purchaseRules.length > 0 ? fill(copy.refill, { parent: names.parent }) : null },
    // Only once a real PayPal top-up is on record, so the PayPal Agent Toolkit has PayPal's own record to read.
    { tool: "get_paypal_order", text: circle.ledger.entries.some(isRealTopUp) ? copy.paypalRecord : null },
  ];
  return asked.flatMap(({ tool, text }) => (text !== null && mayUseTool(circle.viewer.role, tool) ? [text] : []));
}
