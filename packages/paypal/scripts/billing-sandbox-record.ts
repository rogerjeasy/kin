/**
 * Runs the pool's subscription, refund and Transaction Search calls against the
 * PayPal SANDBOX through Kin's own adapter (`poolFor`), and records every
 * exchange the adapter made, scrubbed, for the adapter's fixtures. Run from
 * the repository root:
 *
 *   pnpm --filter @kin/paypal run billing:record subscription --record <file>
 *   pnpm --filter @kin/paypal run billing:record subscription-actions <I-…> --record <file>
 *   pnpm --filter @kin/paypal run billing:record refund --record <file>
 *   pnpm --filter @kin/paypal run billing:record search <payout item id> --record <file>
 *
 * `refund` needs a capture the pool holds: it makes a fresh 1.00 USD card order
 * with PayPal's sandbox test card and refunds it with the REST API directly
 * (Kin itself never refunds), then reads the refund back through the adapter.
 *
 * Safety: it signs in with the pool's `KIN_PAYPAL_CLIENT_*` and refuses any
 * host but PayPal's sandbox. Addresses, payer and merchant IDs and debug IDs are
 * replaced in what it writes, and no credential or token is ever printed.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import { PAYPAL_SANDBOX_API, readPayPalConfig } from "@kin/config";

import { createPayPalClient, type Fetch } from "../src/client.ts";
import { PayPalError } from "../src/paypal-error.ts";
import { paypalPool, type PayPalPool } from "../src/pool.ts";

type Exchange = { readonly method: string; readonly path: string; readonly requestId: string | null; readonly request: unknown; readonly httpStatus: number; readonly body: unknown };

const settings = readPayPalConfig(process.env, { webhook: false });
if (!settings.enabled || settings.apiUrl !== PAYPAL_SANDBOX_API) throw new Error("This script talks only to PayPal's sandbox: set KIN_PAYPAL_CLIENT_ID and KIN_PAYPAL_CLIENT_SECRET.");
const { clientId, clientSecret } = settings;

const exchanges: Exchange[] = [];

/** The scrubbed copy of a body: every address, payer, merchant and debug ID replaced. */
function scrub(value: unknown): unknown {
  const text = JSON.stringify(value ?? null)
    .replace(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, (_match, domain: string) => `someone@${domain}`)
    .replace(/"(payer_id|merchant_id|account_id|paypal_account_id|account_number)":"[^"]*"/g, '"$1":"PLACEHOLDER"')
    .replace(/"debug_id":"[^"]*"/g, '"debug_id":"DEBUGID"')
    .replace(/"(given_name|surname|full_name|alternate_full_name)":"[^"]*"/g, '"$1":"Placeholder"')
    .replace(/"national_number":"[^"]*"/g, '"national_number":"5555550100"')
    .replace(/"(line1|line2|city|state|postal_code)":"[^"]*"/g, '"$1":"Placeholder"');
  return JSON.parse(text) as unknown;
}

const recordingFetch: Fetch = async (input, init) => {
  const response = await fetch(input, init);
  const url = new URL(input);
  if (url.pathname === "/v1/oauth2/token") return response;
  const text = await response.clone().text();
  const headers = new Headers(init.headers);
  let body: unknown;
  try {
    body = text === "" ? null : (JSON.parse(text) as unknown);
  } catch {
    body = { unreadable: true };
  }
  exchanges.push({
    method: init.method ?? "GET",
    path: `${url.pathname}${url.search}`,
    requestId: headers.get("PayPal-Request-Id"),
    request: typeof init.body === "string" ? scrub(JSON.parse(init.body)) : null,
    httpStatus: response.status,
    body: scrub(body),
  });
  return response;
};

function pool(): PayPalPool {
  const client = createPayPalClient({
    apiUrl: PAYPAL_SANDBOX_API,
    clientId,
    clientSecret,
    fetch: recordingFetch,
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (call) => console.log(JSON.stringify(call)),
  });
  return paypalPool(client, "");
}

/** Runs one adapter call and prints what it returned or what PayPal refused, never stopping the run. */
async function step<T>(name: string, run: () => Promise<T>): Promise<T | null> {
  try {
    const result = await run();
    console.log(JSON.stringify({ step: name, result: scrub(result) }));
    return result;
  } catch (error) {
    const summary = error instanceof PayPalError ? { outcome: error.outcome, status: error.status, issue: error.issue } : { error: String(error) };
    console.log(JSON.stringify({ step: name, refused: summary }));
    return null;
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function subscription(): Promise<void> {
  const kin = pool();
  const key = randomUUID();
  const ask = {
    amount: { cents: 100, currency: "USD" },
    reference: { circleId: randomUUID(), memberId: randomUUID() },
    description: "Kin sandbox check: monthly share",
    returnUrl: "https://kin.example.com/dashboard/shares",
  };
  const created = await step("createSubscription", () => kin.createSubscription(ask, key));
  // The same share asked for again, as after a lost answer.
  await step("createSubscription again, same key", () => kin.createSubscription(ask, key));
  // Another share in the same circle: it should reuse the circle's one product.
  await step("createSubscription, same circle, another share", () => kin.createSubscription(ask, randomUUID()));
  if (created === null) return;
  await step("getSubscription", () => kin.getSubscription(created.subscriptionId));
  const now = new Date();
  await step("listSubscriptionPayments", () => kin.listSubscriptionPayments(created.subscriptionId, new Date(now.getTime() - 86_400_000), now));
  await step("suspend while APPROVAL_PENDING", () => kin.changeSubscription(created.subscriptionId, "suspend", "Kin sandbox check", randomUUID()));
  await step("activate while APPROVAL_PENDING", () => kin.changeSubscription(created.subscriptionId, "activate", "Kin sandbox check", randomUUID()));
  console.log(JSON.stringify({ approve: created.approvalUrl, subscriptionId: created.subscriptionId }));
}

async function subscriptionActions(id: string): Promise<void> {
  const kin = pool();
  const now = new Date();
  await step("getSubscription", () => kin.getSubscription(id));
  await step("listSubscriptionPayments", () => kin.listSubscriptionPayments(id, new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 60_000)));
  await step("reviseSubscription to 2.00", () => kin.reviseSubscription(id, { cents: 200, currency: "USD" }, "https://kin.example.com/dashboard/shares", randomUUID()));
  await step("getSubscription after revise", () => kin.getSubscription(id));
  for (const action of ["suspend", "suspend", "activate", "activate", "cancel", "activate"] as const) {
    await step(action, () => kin.changeSubscription(id, action, "Kin sandbox check", randomUUID()));
    await pause(2_000);
    await step(`getSubscription after ${action}`, () => kin.getSubscription(id));
  }
}

/** The REST calls Kin never makes: a card order captured at once, and a refund of it. Kept to this script. */
async function directCall(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const token = await fetch(`${PAYPAL_SANDBOX_API}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const access = ((await token.json()) as Record<string, unknown>)["access_token"];
  if (typeof access !== "string") throw new Error(`Sign-in to the sandbox failed: HTTP ${token.status}`);
  const response = await fetch(`${PAYPAL_SANDBOX_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", "PayPal-Request-Id": `kin-refund-check-${randomUUID()}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>;
  exchanges.push({ method, path, requestId: "(direct)", request: scrub(body ?? null), httpStatus: response.status, body: scrub(json) });
  return { status: response.status, json };
}

function captureIdOf(order: Record<string, unknown>): string | null {
  const units = order["purchase_units"] as { payments?: { captures?: { id?: string }[] } }[] | undefined;
  return units?.[0]?.payments?.captures?.[0]?.id ?? null;
}

async function refund(): Promise<void> {
  const order = await directCall("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "USD", value: "1.00" }, description: "Kin sandbox check: refund" }],
    // PayPal's sandbox test Visa: an order paid by card is captured without a buyer's approval.
    payment_source: { card: { number: "4111111111111111", expiry: "2030-12", name: "Kin Check", security_code: "123" } },
  });
  let captureId = captureIdOf(order.json);
  console.log(JSON.stringify({ step: "card order", status: order.status, orderStatus: order.json["status"], captureId }));
  if (captureId === null && order.json["status"] === "APPROVED" && typeof order.json["id"] === "string") {
    const captured = await directCall("POST", `/v2/checkout/orders/${order.json["id"]}/capture`, {});
    captureId = captureIdOf(captured.json);
    console.log(JSON.stringify({ step: "capture", status: captured.status, captureId }));
  }
  if (captureId === null) return;
  const kin = pool();
  await step("getCapture before refund", () => kin.getCapture(captureId));
  const refunded = await directCall("POST", `/v2/payments/captures/${captureId}/refund`, { amount: { currency_code: "USD", value: "0.40" }, note_to_payer: "Kin sandbox check" });
  const refundId = typeof refunded.json["id"] === "string" ? refunded.json["id"] : null;
  console.log(JSON.stringify({ step: "refund", status: refunded.status, refundId, refundStatus: refunded.json["status"] }));
  if (refundId === null) return;
  await pause(3_000);
  await step("getRefund", () => kin.getRefund(refundId));
  await step("getCapture after refund", () => kin.getCapture(captureId));
}

async function search(itemId: string): Promise<void> {
  await step("getPayoutTransaction", () => pool().getPayoutTransaction(itemId, new Date()));
}

const argv = process.argv.slice(2);
const recordAt = argv.indexOf("--record");
const recordFile = recordAt === -1 ? null : (argv[recordAt + 1] ?? null);
const [command, argument] = recordAt === -1 ? argv : argv.slice(0, recordAt);

const need = (value: string | undefined, what: string): string => {
  if (!value) throw new Error(`Pass the ${what}.`);
  return value;
};

switch (command) {
  case "subscription":
    await subscription();
    break;
  case "subscription-actions":
    await subscriptionActions(need(argument, "subscription ID"));
    break;
  case "refund":
    await refund();
    break;
  case "search":
    await search(need(argument, "payout item ID"));
    break;
  default:
    throw new Error("Commands: subscription, subscription-actions <I-…>, refund, search <payout item id>");
}

if (recordFile !== null) {
  writeFileSync(recordFile, `${JSON.stringify({ recordedOn: new Date().toISOString().slice(0, 10), environment: "PayPal sandbox", command, exchanges }, null, 2)}\n`);
  console.log(`Exchanges written to ${recordFile}`);
}
