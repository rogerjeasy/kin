import { checkTopUp, centsFromDecimal, InvalidDecimalError, type TopUpCheck } from "@kin/domain";
import type { CircleSnapshot } from "@kin/db";
import { PayPalError, captureRequestId, type Inbox, type Order, type PayPalPool } from "@kin/paypal";
import { randomUUID } from "node:crypto";

import { may } from "./dashboard-context";
import { typedAmount } from "@/lib/typed-amount";

type Services = { readonly pool: PayPalPool; readonly inbox: Inbox };

export type StartRefusal = "role" | "amount" | Extract<TopUpCheck, { ok: false }>["reason"] | "paypal";

export type StartResult = { readonly ok: true; readonly orderId: string } | { readonly ok: false; readonly reason: StartRefusal };

/**
 * Opens a PayPal order for the viewer's top-up. The amount is read from the
 * text the person typed, in whole cents, and checked against the limits; the
 * order names the circle and the member, so PayPal's own record says whose
 * money it is.
 */
export async function startTopUp(services: Services, circle: CircleSnapshot, input: { amount: unknown; returnUrl: string; description: string }): Promise<StartResult> {
  if (!may(circle, "money.contribute")) return { ok: false, reason: "role" };
  if (typeof input.amount !== "string") return { ok: false, reason: "amount" };
  let cents: number;
  try {
    cents = centsFromDecimal(typedAmount(input.amount), circle.circle.currency);
  } catch (error) {
    if (error instanceof InvalidDecimalError) return { ok: false, reason: "amount" };
    throw error;
  }
  const amount = { cents, currency: circle.circle.currency };
  const check = checkTopUp(amount);
  if (!check.ok) return { ok: false, reason: check.reason };
  try {
    const { orderId } = await services.pool.createOrder(
      { amount, reference: { circleId: circle.circle.id, memberId: circle.viewer.memberId }, description: input.description, returnUrl: input.returnUrl },
      `kin-top-up-${randomUUID()}`,
    );
    return { ok: true, orderId };
  } catch (error) {
    if (error instanceof PayPalError) return { ok: false, reason: "paypal" };
    throw error;
  }
}

export type ConfirmResult =
  /** PayPal took the money; the worker is confirming it. `captureId` is what to watch for. */
  | { readonly ok: true; readonly captureId: string | null }
  | { readonly ok: false; readonly reason: "role" | "not_yours" | "declined" };

/**
 * Captures an order the payer approved, then asks the worker to read the order
 * back from PayPal and record it. The capture's answer is never taken as proof:
 * the ledger is written only from what PayPal says when asked again
 * (AGENTS.md section 5, rule 3). A capture PayPal declined is reported as
 * declined. Any other failure leaves it unknown whether the capture happened,
 * so the worker is asked to look, and to finish the capture if it did not.
 */
export async function confirmTopUp(services: Services, circle: CircleSnapshot, orderId: string): Promise<ConfirmResult> {
  if (!may(circle, "money.contribute")) return { ok: false, reason: "role" };
  const order = await readOrder(services.pool, orderId);
  if (order === null || order.reference?.circleId !== circle.circle.id || order.reference.memberId !== circle.viewer.memberId) {
    return { ok: false, reason: "not_yours" };
  }
  let captured: Order = order;
  if (order.status !== "COMPLETED") {
    try {
      // One request ID per order, so a repeated click, a retry or the worker cannot capture twice.
      captured = await services.pool.captureOrder(orderId, captureRequestId(orderId));
    } catch (error) {
      if (error instanceof PayPalError && error.outcome === "rejected") return { ok: false, reason: "declined" };
      console.error(JSON.stringify({ message: "top_up.capture_unknown", error: error instanceof Error ? error.name : "unknown" }));
    }
  }
  const capture = captured.captures[0];
  if (capture?.status === "DECLINED" || capture?.status === "FAILED") return { ok: false, reason: "declined" };
  try {
    await services.inbox.send({ kind: "order_captured", circleId: circle.circle.id, orderId });
  } catch (error) {
    // The money is PayPal's to report: its webhook reaches the worker without this message.
    console.error(JSON.stringify({ message: "top_up.inbox_unavailable", error: error instanceof Error ? error.name : "unknown" }));
  }
  // Only a completed capture is worth waiting for; a pending one is the webhook's to report.
  return { ok: true, captureId: capture?.status === "COMPLETED" ? capture.id : null };
}

async function readOrder(pool: PayPalPool, orderId: string): Promise<Order | null> {
  try {
    return await pool.getOrder(orderId);
  } catch (error) {
    if (error instanceof PayPalError && error.outcome === "rejected") return null;
    throw error;
  }
}
