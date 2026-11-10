import type { CircleAction } from "@kin/auth";

import type { ObjectSchema } from "./tool-schema.ts";

/**
 * Every tool Ask Kin may offer, and the role table: the circle action each one
 * needs, decided by `authorize` in packages/auth like every other access
 * check. Nine tools only read. One proposes a refill, which still waits for
 * the yeses the family agreement names, and one, for the parent alone,
 * proposes a payment from her Purse, which waits for her own yes after Kin
 * reads it back. None approves, pays, moves money or edits a record, and no
 * PayPal write is reachable from here (AGENTS.md section 7).
 */

const NAME = { type: "string", maxLength: 80, pattern: "^[^<>{}\\n\\r]+$" } as const;
const NONE = { type: "object", properties: {}, required: [], additionalProperties: false } as const satisfies ObjectSchema;

export const ASK_KIN_TOOLS = {
  get_pool: {
    kind: "read",
    action: "money.view",
    description: "The circle's pool: its confirmed balance now, and this month's money paid in, paid out and PayPal fees. Use it for any question about how much money there is.",
    inputSchema: NONE,
  },
  list_bills: {
    kind: "read",
    action: "own_payments.view",
    description: "The circle's bills: those the family expects next, those waiting for approval, and those paid, with payee, amount and day. A caregiver sees only their own.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", description: "Which bills: upcoming, waiting, paid or all.", maxLength: 8, enum: ["upcoming", "waiting", "paid", "all"] } },
      required: [],
      additionalProperties: false,
    },
  },
  get_fairness: {
    kind: "read",
    action: "money.view",
    description: "This month's fairness, as Kin's money core calculates it: each sharing member's agreed share, what they gave, and who owes whom to settle. Use it for any question about shares, fairness or who owes whom.",
    inputSchema: NONE,
  },
  check_claim: {
    kind: "read",
    action: "claim.check",
    description: "Checks a demand for money against the record, with Kin's fixed rules: is the payee known, is there an open bill of that amount, was it already paid. It only reads; nobody is alerted. Use it when someone asks whether a demand, call or letter is real.",
    inputSchema: {
      type: "object",
      properties: {
        payee: { ...NAME, description: "Who the demand says it is from, as the person wrote it." },
        amount: { type: "string", description: "The amount demanded, as plain digits with an optional decimal point, such as 300 or 300.00. Leave out when none was named.", maxLength: 12, pattern: "^\\d{1,9}(\\.\\d{1,2})?$" },
      },
      required: ["payee"],
      additionalProperties: false,
    },
  },
  list_proposals: {
    kind: "read",
    action: "own_payments.view",
    description: "The payments waiting for a yes, and who still has to say yes to each, as the approval engine decided. Kin cannot answer for anyone.",
    inputSchema: NONE,
  },
  get_record: {
    kind: "read",
    action: "money.view",
    description: "The newest entries of the circle's ledger: what happened, to whom, how much and on which day, and whether it was simulated.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", description: "How many entries, newest first, from 1 to 10: the number the person asked for, or 6.", minimum: 1, maximum: 10 } },
      required: [],
      additionalProperties: false,
    },
  },
  get_paypal_payout_status: {
    kind: "read",
    action: "own_payments.view",
    description: "Whether someone has been paid: the payouts the record holds for a payee or caregiver, and, for a real payout, its status read from PayPal now. Simulated payouts in a demo say so.",
    inputSchema: {
      type: "object",
      properties: { payee: { ...NAME, description: "The payee or caregiver, by name. Leave out for the latest payouts." } },
      required: [],
      additionalProperties: false,
    },
  },
  get_paypal_topup_status: {
    kind: "read",
    action: "money.view",
    description: "The members' top-ups into the pool: amount, day and, for a real top-up, the status of its capture read from PayPal now. Simulated top-ups in a demo say so.",
    inputSchema: {
      type: "object",
      properties: { member: { ...NAME, description: "The member who topped up, by name. Leave out for the latest top-ups." } },
      required: [],
      additionalProperties: false,
    },
  },
  get_subscription_status: {
    kind: "read",
    action: "money.view",
    description: "Each member's monthly share through PayPal subscriptions: its amount, its state and its next charge, read from PayPal for a real one. Simulated shares in a demo say so.",
    inputSchema: {
      type: "object",
      properties: { member: { ...NAME, description: "The member, by name. Leave out for every member." } },
      required: [],
      additionalProperties: false,
    },
  },
  propose_refill: {
    kind: "propose",
    action: "refill.propose",
    description:
      "Asks Kin to propose a refill the family's rules already allow, at the rule's own price. It buys nothing: the refill then waits for the yeses the family agreement names, unless the parent's standing permission covers it. Use it only when the person asks for a reorder or refill.",
    inputSchema: {
      type: "object",
      properties: { item: { ...NAME, description: "The item to reorder, by name, if the person named one. Leave out to reorder the circle's only refill." } },
      required: [],
      additionalProperties: false,
    },
  },
  propose_gift: {
    kind: "propose",
    action: "purse.spend",
    description:
      "For the parent only: asks Kin to send a small payment from her own Purse, such as a gift, a tip or a donation, to someone she names. It pays nothing: Kin reads the payment back and it waits for her own yes, and Kin's rules hold it for a day, with the family told, when the person is not in her address book, the amount is above her limit or the request looks pressured. Use it only when she asks to send, give or pay someone money from her Purse.",
    inputSchema: {
      type: "object",
      properties: {
        payee: { ...NAME, description: "Who is to be paid, exactly as she named them." },
        amount: { type: "string", description: "The amount she named, as plain digits with an optional decimal point, such as 25 or 25.00.", maxLength: 12, pattern: "^\\d{1,9}(\\.\\d{1,2})?$" },
        memo: { type: "string", description: "What it is for, in her words, such as for her birthday. Leave out when she did not say.", maxLength: 120, pattern: "^[^<>{}\\n\\r]+$" },
      },
      required: ["payee", "amount"],
      additionalProperties: false,
    },
  },
} as const satisfies Record<string, { readonly kind: "read" | "propose"; readonly action: CircleAction; readonly description: string; readonly inputSchema: ObjectSchema }>;

export type AskKinToolName = keyof typeof ASK_KIN_TOOLS;

export const ASK_KIN_TOOL_NAMES = Object.keys(ASK_KIN_TOOLS) as AskKinToolName[];

export function isAskKinTool(name: string): name is AskKinToolName {
  return Object.hasOwn(ASK_KIN_TOOLS, name);
}
