/**
 * Exercises Invoicing v2 in the PayPal sandbox through Kin's own adapter, so
 * the adapter's parsing is checked against what PayPal really answers:
 *
 *   invoice <recipient email> [cents]   make, send and read back an invoice
 *   invoice-read <invoice id>           read one back, with the capture behind each PayPal payment
 *
 * `--record <file>` writes the raw responses beside the adapter's tests, with
 * every email address and merchant ID replaced by a placeholder. Nothing here
 * prints a credential or a token.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import { readPayPalConfig } from "@kin/config";

import { createPayPalClient } from "../../src/client.ts";
import { invoiceNumberFor, parseInvoice } from "../../src/invoice.ts";
import { paypalPool } from "../../src/pool.ts";
import { currency } from "./client.ts";

function signedIn() {
  const settings = readPayPalConfig(process.env, { webhook: false });
  if (!settings.enabled) throw new Error("Set KIN_PAYPAL_CLIENT_ID and KIN_PAYPAL_CLIENT_SECRET in the repository's .env");
  const client = createPayPalClient({
    ...settings,
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (call) => console.log(`  ${call.operation}: HTTP ${call.status ?? "no answer"} (debug ID ${call.debugId ?? "none"})`),
  });
  return { client, pool: paypalPool(client, "") };
}

const recorded: Record<string, unknown> = {};

function record(name: string, value: unknown): void {
  recorded[name] = JSON.parse(placeholders(JSON.stringify(value))) as unknown;
}

function placeholders(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@(personal|business)\.example\.com/g, (_match, kind: string) => `${kind === "personal" ? "member" : "pool"}@${kind}.example.com`)
    .replace(/"merchant_id":"[A-Z0-9]+"/g, '"merchant_id":"POOLMERCHANTID"');
}

export async function makeInvoice(recipientEmail: string, cents: number): Promise<void> {
  const { client, pool } = signedIn();
  const reference = { circleId: randomUUID(), requestId: randomUUID() };
  const invoice = { number: invoiceNumberFor(reference.requestId), amount: { cents, currency }, recipientEmail, reference, itemName: "Share of care costs (Kin sandbox check)", note: "Kin sandbox check: test money only." };
  const key = `kin-check-invoice-${reference.requestId}`;
  const { invoiceId } = await pool.createInvoice(invoice, key);
  console.log(`Draft made: ${invoiceId}`);
  record("draft", await client.send({ method: "GET", path: `/v2/invoicing/invoices/${invoiceId}`, operation: "invoices.get" }));
  // The same request again, as after a lost reply: the adapter must find the same draft, never make a second one.
  const again = await pool.createInvoice(invoice, key);
  console.log(`The same request again: ${again.invoiceId === invoiceId ? "the same draft" : `A SECOND DRAFT ${again.invoiceId}`}`);
  await pool.sendInvoice(invoiceId, `kin-check-send-${reference.requestId}`);
  const raw = await client.send({ method: "GET", path: `/v2/invoicing/invoices/${invoiceId}`, operation: "invoices.get" });
  record("sent", raw);
  const read = parseInvoice(raw);
  console.log(`Read back: ${read.status}, number ${read.number ?? "none"}, ${read.amount.cents} cents, memo names Kin's request: ${read.reference?.requestId === reference.requestId}`);
  console.log(`The member pays it at: ${read.payerUrl ?? "(no payer link)"}`);
}

export async function readInvoice(invoiceId: string): Promise<void> {
  const { client, pool } = signedIn();
  const raw = await client.send({ method: "GET", path: `/v2/invoicing/invoices/${invoiceId}`, operation: "invoices.get" });
  record("invoice", raw);
  const invoice = parseInvoice(raw);
  console.log(`${invoice.id}: ${invoice.status}, number ${invoice.number ?? "none"}, ${invoice.amount.cents} cents, ${invoice.payments.length} payment(s)`);
  for (const payment of invoice.payments) {
    if (payment.paymentId === null) {
      console.log(`  a payment recorded by hand, not through PayPal: ${payment.amount.cents} cents`);
      continue;
    }
    const capture = await pool.getCapture(payment.paymentId);
    record(`capture ${payment.paymentId}`, await client.send({ method: "GET", path: `/v2/payments/captures/${payment.paymentId}`, operation: "captures.get" }));
    console.log(`  capture ${capture.id}: ${capture.status}, gross ${capture.gross.cents}, fee ${capture.fee.cents}, names invoice ${capture.invoiceId ?? "none"}`);
  }
}

/** Writes what was recorded, when `--record <file>` was given. */
export function saveRecording(argv: readonly string[]): void {
  const at = argv.indexOf("--record");
  const file = at === -1 ? undefined : argv[at + 1];
  if (file === undefined) return;
  writeFileSync(file, `${JSON.stringify(recorded, null, 2)}\n`);
  console.log(`Recorded to ${file}`);
}
