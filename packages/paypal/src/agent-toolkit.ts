import { PAYPAL_SANDBOX_API } from "@kin/config";

import { parseDispute, parseDisputeList, isDisputeId, type Dispute } from "./dispute.ts";
import { isInvoiceId, parseInvoice, type Invoice } from "./invoice.ts";
import { asRecord, optionalText, parseJson } from "./json.ts";
import { parseOrder, type Order } from "./order.ts";
import { isPayPalId } from "./pool.ts";

/**
 * PayPal's Agent Toolkit (`@paypal/agent-toolkit`), as Kin's agent reaches it.
 *
 * Kin enables four of the toolkit's actions, every one a read: an order, an
 * invoice, the disputes on a transaction and one dispute. No toolkit tool that
 * creates, sends, captures, refunds, cancels or updates is ever switched on,
 * and the model is never handed the toolkit's own tools: Kin's tool gateway
 * offers Kin's tools, and their implementations call these reads with IDs
 * taken from the circle's own record (docs/architecture.md section 9.3).
 *
 * Two facts of version 1.11.0, read in its source, shape this wrapper:
 * - `handleToolCall` runs whatever method it is named, enabled or not, so
 *   Kin names only its own fixed methods and checks each is among the tools
 *   the toolkit was configured with before calling it.
 * - The toolkit caches its access token for the life of the instance and never
 *   renews it, while PayPal's sandbox tokens last 3 to 8 hours, so Kin makes a
 *   fresh instance every hour.
 *
 * Its answer is PayPal's own JSON, so Kin reads it with the same parsers as
 * its own adapter; a toolkit error is a `ToolkitError`, never PayPal's text.
 */

/** The toolkit's `configuration.actions`: reads only. */
export const AGENT_TOOLKIT_ACTIONS = { orders: { get: true }, invoices: { get: true }, disputes: { list: true, get: true } } as const;

/** The toolkit methods those actions enable, and the only ones Kin ever names. */
export const AGENT_TOOLKIT_METHODS = ["get_order", "get_invoice", "list_disputes", "get_dispute"] as const;
export type AgentToolkitMethod = (typeof AGENT_TOOLKIT_METHODS)[number];

/** The part of the toolkit's Bedrock entry Kin uses; the real class has this shape, and tests pass a fake. */
export type AgentToolkit = {
  readonly getTools: () => readonly { readonly toolSpec: { readonly name: string } }[];
  readonly handleToolCall: (call: { toolUseId: string; name: string; input: Record<string, string | number> }) => Promise<{ readonly content: readonly { readonly text: string }[] }>;
};

/** An order as the toolkit's `get_order` returns it, with PayPal's own times. */
export type ToolkitOrder = Order & { readonly createdAt: Date | null; readonly updatedAt: Date | null };

/** The reads Ask Kin's PayPal Agent Toolkit tools make. */
export type AgentToolkitReads = {
  readonly getOrder: (orderId: string) => Promise<ToolkitOrder>;
  readonly getInvoice: (invoiceId: string) => Promise<Invoice>;
  /** The disputes PayPal lists for one of the pool's transactions. */
  readonly listDisputes: (transactionId: string) => Promise<Dispute[]>;
  readonly getDispute: (disputeId: string) => Promise<Dispute>;
};

export type ToolkitErrorReason = "not_enabled" | "bad_id" | "paypal_refused" | "unreadable";

/** A toolkit read that did not give Kin a usable answer. It carries no text of PayPal's. */
export class ToolkitError extends Error {
  readonly reason: ToolkitErrorReason;
  /** PayPal's HTTP status, when the toolkit reported one. */
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(method: AgentToolkitMethod, reason: ToolkitErrorReason, status: number | null = null) {
    super(`PayPal Agent Toolkit ${method}: ${reason}${status === null ? "" : ` (HTTP ${status})`}`);
    this.name = "ToolkitError";
    this.reason = reason;
    this.status = status;
    this.retryable = reason === "paypal_refused" && (status === null || status >= 500);
  }
}

/** PayPal's JSON from the toolkit's text, which `handleToolCall` encodes twice. */
function decode(method: AgentToolkitMethod, text: string | undefined): unknown {
  if (text === undefined) throw new ToolkitError(method, "unreadable");
  let value: unknown = parseJson(text, "toolkit answer");
  if (typeof value === "string") value = parseJson(value, "toolkit answer");
  const record = asRecord(value, "toolkit answer");
  // The toolkit reports a failure as data: `{ error: {...} }`, or an LlmError with `ok: false`.
  if (record["error"] !== undefined || record["ok"] === false) {
    const status = typeof record["status"] === "number" ? record["status"] : null;
    throw new ToolkitError(method, "paypal_refused", status);
  }
  return record;
}

const ID_CHECKS: Readonly<Record<AgentToolkitMethod, (id: string) => boolean>> = {
  get_order: isPayPalId,
  get_invoice: isInvoiceId,
  list_disputes: isPayPalId,
  get_dispute: isDisputeId,
};

/** Kin's four reads over a toolkit, which `source` hands over fresh enough to use. */
export function agentToolkitReads(source: () => Promise<AgentToolkit>): AgentToolkitReads {
  async function run(method: AgentToolkitMethod, id: string, input: Record<string, string | number>): Promise<unknown> {
    if (!ID_CHECKS[method](id)) throw new ToolkitError(method, "bad_id");
    const toolkit = await source();
    if (!toolkit.getTools().some((tool) => tool.toolSpec.name === method)) throw new ToolkitError(method, "not_enabled");
    const answer = await toolkit.handleToolCall({ toolUseId: `kin-${method}`, name: method, input });
    try {
      return decode(method, answer.content[0]?.text);
    } catch (error) {
      throw error instanceof ToolkitError ? error : new ToolkitError(method, "unreadable");
    }
  }

  /** Parses PayPal's JSON with Kin's own reader; a shape Kin does not know is unreadable. */
  function read<T>(method: AgentToolkitMethod, parse: (value: unknown) => T) {
    return async (id: string, input: Record<string, string | number>): Promise<T> => {
      const value = await run(method, id, input);
      try {
        return parse(value);
      } catch {
        throw new ToolkitError(method, "unreadable");
      }
    };
  }

  const order = read("get_order", (value) => {
    const record = asRecord(value, "order");
    const timeOf = (key: string) => {
      const text = optionalText(record, key);
      const time = text === null ? null : new Date(text);
      return time === null || Number.isNaN(time.getTime()) ? null : time;
    };
    return { ...parseOrder(record), createdAt: timeOf("create_time"), updatedAt: timeOf("update_time") };
  });
  const invoice = read("get_invoice", parseInvoice);
  const disputes = read("list_disputes", parseDisputeList);
  const dispute = read("get_dispute", parseDispute);

  return {
    getOrder: (orderId) => order(orderId, { id: orderId }),
    getInvoice: (invoiceId) => invoice(invoiceId, { invoice_id: invoiceId }),
    // The toolkit applies no defaults of its own here, so Kin sends the page size it wants.
    listDisputes: (transactionId) => disputes(transactionId, { disputed_transaction_id: transactionId, page_size: 10 }),
    getDispute: (disputeId) => dispute(disputeId, { dispute_id: disputeId }),
  };
}

/** How long one toolkit instance, and the access token it caches, is used. */
export const TOOLKIT_RENEW_MS = 60 * 60 * 1000;

/** The toolkit, made again once `everyMs` has passed, or when making it failed. */
export function renewing(make: () => Promise<AgentToolkit>, now: () => number, everyMs: number = TOOLKIT_RENEW_MS): () => Promise<AgentToolkit> {
  let current: { readonly toolkit: Promise<AgentToolkit>; readonly madeAt: number } | null = null;
  return () => {
    if (current === null || now() - current.madeAt >= everyMs) {
      const toolkit = make();
      current = { toolkit, madeAt: now() };
      toolkit.catch(() => {
        if (current?.toolkit === toolkit) current = null;
      });
    }
    return current.toolkit;
  };
}

type Credentials = { readonly clientId: string; readonly clientSecret: string };

/** The real toolkit, configured with Kin's read actions against PayPal's sandbox. Loaded on first use. */
export async function createAgentToolkit(credentials: Credentials): Promise<AgentToolkit> {
  const { PayPalAgentToolkit } = await import("@paypal/agent-toolkit/bedrock");
  return new PayPalAgentToolkit({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    configuration: { actions: AGENT_TOOLKIT_ACTIONS, context: { sandbox: true } },
  });
}

/**
 * The toolkit's reads for the pool's PayPal app, or `null` when Kin talks to a
 * stand-in for PayPal: the toolkit always calls PayPal itself, so it would go
 * around the stand-in.
 */
export function agentToolkitFor(settings: Credentials & { readonly apiUrl: string }, now: () => number = Date.now): AgentToolkitReads | null {
  if (settings.apiUrl !== PAYPAL_SANDBOX_API) return null;
  return agentToolkitReads(renewing(() => createAgentToolkit(settings), now));
}
