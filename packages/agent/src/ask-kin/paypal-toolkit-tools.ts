import type { CircleAction } from "@kin/auth";

import type { ObjectSchema } from "./tool-schema.ts";

/**
 * Ask Kin's tools that read PayPal through PayPal's own Agent Toolkit
 * (packages/paypal/src/agent-toolkit.ts). Each only reads, and none takes a
 * PayPal ID from the model: the model names a member at most, and the web
 * app's implementation finds the PayPal order, invoice or transaction in the
 * circle's own record, as the person may read it, then checks that PayPal's
 * answer names that same circle before anything is shown. The toolkit's
 * transaction list and its subscription and shipment tools are not exposed:
 * the first spans every family's pool account and cannot be tied to one
 * circle, Kin's own adapter already reads subscriptions, and the pharmacy's
 * orders belong to its own PayPal account, not the pool's.
 *
 * All three need `money.view`: a caregiver, who sees only their own pay, is
 * refused them, and an observer reads them like any other read.
 */

const MEMBER = {
  type: "string",
  maxLength: 80,
  pattern: "^[^<>{}\\n\\r]+$",
} as const;

export const PAYPAL_TOOLKIT_TOOLS = {
  get_paypal_order: {
    kind: "read",
    action: "money.view",
    description:
      "PayPal's own record of a top-up, read from PayPal now through the PayPal Agent Toolkit: the PayPal order behind the newest real top-up, its status, amount, times and capture. A simulated top-up has no PayPal record, and the result says so. Use it when someone asks what PayPal itself says about a top-up.",
    inputSchema: {
      type: "object",
      properties: { member: { ...MEMBER, description: "Whose top-up: the member's name, or exactly me for the person asking. Leave out for the newest top-up of anyone." } },
      required: [],
      additionalProperties: false,
    },
  },
  get_paypal_invoice: {
    kind: "read",
    action: "money.view",
    description:
      "PayPal's own record of an invoice Kin sent a member, read from PayPal now through the PayPal Agent Toolkit: its number, status, amount and what was paid on it. A simulated invoice has no PayPal record, and the result says so. Use it when someone asks whether an invoice was paid or where it stands at PayPal.",
    inputSchema: {
      type: "object",
      properties: { member: { ...MEMBER, description: "The member the invoice was sent to: their name, or exactly me for the person asking. Leave out for the newest invoice." } },
      required: [],
      additionalProperties: false,
    },
  },
  list_paypal_disputes: {
    kind: "read",
    action: "money.view",
    description:
      "Whether anyone has disputed one of the circle's newest real top-ups with PayPal, read from PayPal now through the PayPal Agent Toolkit: each dispute's status, reason and amount. Use it when someone asks about a dispute, a chargeback or a payment someone says they did not make.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
} as const satisfies Record<string, { readonly kind: "read"; readonly action: CircleAction; readonly description: string; readonly inputSchema: ObjectSchema }>;

export type PayPalToolkitToolName = keyof typeof PAYPAL_TOOLKIT_TOOLS;

/** The tools the trace labels as PayPal's Agent Toolkit. */
export const PAYPAL_TOOLKIT_TOOL_NAMES = Object.keys(PAYPAL_TOOLKIT_TOOLS) as PayPalToolkitToolName[];
