import { CATALOG, SELLER_NAME } from "./catalog.ts";
import { AboveMandateError, ChargeError, DailyLimitError, UnknownItemError, type OrderBook, type OrderRequest } from "./orders.ts";
import { PAYPAL_ORDER_ID } from "./wallet.ts";

export type MerchantRequest = { readonly method: string; readonly path: string; readonly body: unknown };
export type MerchantReply = { readonly status: number; readonly body: Record<string, unknown> };

const MAX_BODY_BYTES = 4_096;

/** The most the pharmacy reads of a request body; a longer one is refused before it is parsed. */
export const BODY_LIMIT = MAX_BODY_BYTES;

const ORDER_PATH = /^\/orders\/([A-Za-z0-9_-]{1,120})$/;
const PAYMENT_PATH = /^\/payments\/([^/]{1,64})$/;

/**
 * The pharmacy's four routes, as plain data in and out so they are tested
 * without a socket: its catalog, taking an order, where an order is, and
 * what PayPal's record of a payment says now. Every reply says the pharmacy
 * is a stand-in; a payment's reply comes from PayPal, read as it is asked.
 */
export async function handle(book: OrderBook, request: MerchantRequest): Promise<MerchantReply> {
  const standIn = { seller: SELLER_NAME, standIn: true };
  if (request.method === "GET" && request.path === "/catalog") return { status: 200, body: { ...standIn, items: CATALOG } };
  if (request.method === "POST" && request.path === "/orders") return placeOrder(book, request.body, standIn);
  const match = request.method === "GET" ? ORDER_PATH.exec(request.path) : null;
  if (match?.[1] !== undefined) {
    const state = book.progress(match[1]);
    return state === null ? { status: 404, body: { error: "unknown_order" } } : { status: 200, body: { ...standIn, ref: match[1], state } };
  }
  const payment = request.method === "GET" ? PAYMENT_PATH.exec(request.path) : null;
  if (payment?.[1] !== undefined) return readPayment(book, payment[1], standIn);
  return { status: 404, body: { error: "not_found" } };
}

async function readPayment(book: OrderBook, orderId: string, standIn: Record<string, unknown>): Promise<MerchantReply> {
  if (!PAYPAL_ORDER_ID.test(orderId)) return { status: 404, body: { error: "unknown_payment" } };
  try {
    const record = await book.payment(orderId);
    return record === null ? { status: 404, body: { error: "unknown_payment" } } : { status: 200, body: { ...standIn, source: "paypal_sandbox", payment: record } };
  } catch (error) {
    if (error instanceof ChargeError) return { status: 502, body: { error: "wallet_unavailable" } };
    throw error;
  }
}

async function placeOrder(book: OrderBook, body: unknown, standIn: Record<string, unknown>): Promise<MerchantReply> {
  const order = parseOrder(body);
  if (order === null) return { status: 400, body: { error: "invalid_order" } };
  try {
    const { ref, charge } = await book.place(order);
    return { status: 201, body: { ...standIn, ref, charge } };
  } catch (error) {
    if (error instanceof UnknownItemError) return { status: 422, body: { error: "unknown_item" } };
    if (error instanceof AboveMandateError) return { status: 403, body: { error: "above_mandate" } };
    if (error instanceof DailyLimitError) return { status: 429, body: { error: "daily_limit" } };
    if (error instanceof ChargeError) return { status: error.retryable ? 502 : 402, body: { error: error.retryable ? "wallet_unavailable" : "charge_refused" } };
    throw error;
  }
}

const MANDATE_ID = /^[A-Za-z0-9_-]{1,100}$/;

function parseMandate(value: unknown): NonNullable<OrderRequest["mandate"]> | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, allowanceCents, ...extra } = value as Record<string, unknown>;
  if (Object.keys(extra).length > 0 || typeof id !== "string" || !MANDATE_ID.test(id)) return null;
  if (typeof allowanceCents !== "number" || !Number.isSafeInteger(allowanceCents) || allowanceCents <= 0) return null;
  return { id, allowanceCents };
}

function parseOrder(body: unknown): OrderRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const { key, item, cents, currency, mandate, ...extra } = body as Record<string, unknown>;
  if (Object.keys(extra).length > 0) return null;
  if (typeof key !== "string" || typeof item !== "string" || typeof currency !== "string") return null;
  if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents <= 0) return null;
  if (mandate === undefined) return { key, item, cents, currency };
  const parsed = parseMandate(mandate);
  return parsed === null ? null : { key, item, cents, currency, mandate: parsed };
}
