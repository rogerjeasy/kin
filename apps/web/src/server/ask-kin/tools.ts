import type { ToolCallRecord, ToolContext, ToolImplementations } from "@kin/agent";

import { payoutStatus, shareStatus, topUpStatus } from "./paypal-tools";
import { checkDemand, getFairness, getPool, getRecord, listBills, listProposals } from "./record-tools";
import { proposeGift } from "./gift-tool";
import { proposeRefill } from "./refill-tool";
import type { AskKinWorld } from "./world";

/** How many record entries `get_record` returns when the model does not say. */
const DEFAULT_ENTRIES = 6;

/**
 * Ask Kin's tool implementations for one person's question. The gateway in
 * packages/agent has already checked the role and parsed the arguments; each
 * implementation also refuses a context that is not this world's own circle
 * and member, so nothing can point a tool at another circle.
 */
export function askKinTools(world: AskKinWorld): ToolImplementations {
  const ownCircle = (context: ToolContext) => {
    if (context.circleId !== world.circle.circle.id || context.memberId !== world.circle.viewer.memberId) throw new Error("A tool was asked about another circle");
  };
  return {
    get_pool: async (_, context) => {
      ownCircle(context);
      return getPool(world);
    },
    list_bills: async (args, context) => {
      ownCircle(context);
      return listBills(world, args.status ?? "all");
    },
    get_fairness: async (_, context) => {
      ownCircle(context);
      return getFairness(world);
    },
    check_claim: async (args, context) => {
      ownCircle(context);
      return checkDemand(world, args.payee, args.amount);
    },
    list_proposals: async (_, context) => {
      ownCircle(context);
      return listProposals(world);
    },
    get_record: async (args, context) => {
      ownCircle(context);
      return getRecord(world, args.limit ?? DEFAULT_ENTRIES);
    },
    get_paypal_payout_status: async (args, context) => {
      ownCircle(context);
      return payoutStatus(world, args.payee);
    },
    get_paypal_topup_status: async (args, context) => {
      ownCircle(context);
      return topUpStatus(world, args.member);
    },
    get_subscription_status: async (args, context) => {
      ownCircle(context);
      return shareStatus(world, args.member);
    },
    propose_refill: async (args, context) => {
      ownCircle(context);
      return proposeRefill(world, args.item);
    },
    propose_gift: async (args, context) => {
      ownCircle(context);
      return proposeGift(world, args);
    },
  };
}

/**
 * Every tool call, written to the server's structured log: which tool, the
 * arguments with free text masked, the outcome and how long it took. No
 * question, answer or tool result is logged.
 */
export function logToolCall(record: ToolCallRecord, context: ToolContext): void {
  console.info(JSON.stringify({ message: "ask_kin.tool", circleId: context.circleId, memberId: context.memberId, role: context.role, ...record, at: record.at.toISOString() }));
}
