/**
 * Sends a handful of one-item 1.00 USD Payouts batches to the PayPal SANDBOX to
 * learn what it accepts for a Venmo item, through Kin's own `payoutBody` so what
 * is tested is what Kin sends. Run from the repository root:
 *
 *   pnpm --filter @kin/paypal run venmo:probe            send every case
 *   pnpm --filter @kin/paypal run venmo:probe dry-run    print the masked bodies, send nothing
 *   pnpm --filter @kin/paypal run venmo:probe <case>...  send only the named cases
 *   ... --record <file>                                  also write each refusal's raw body there, addresses and IDs masked
 *
 * Cases: venmo-email, venmo-handle-at, venmo-handle-bare, venmo-phone, paypal-control, venmo-forced-failure.
 *
 * Safety: it signs in with the pool's `KIN_PAYPAL_CLIENT_*` and refuses to send
 * to any host but PayPal's sandbox. The email receiver is a sandbox personal
 * account named by `EMAIL_PERSONAL_AMARA` (the project's own). Every address is
 * masked in what it prints, and no credential or token is ever printed. Each
 * case is sent once: a refusal is the finding, never retried.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import { PAYPAL_SANDBOX_API, readPayPalConfig } from "@kin/config";

import { payoutBody, type NewPayout } from "../src/payout.ts";

const PAUSE_MS = 3_000;
const SETTLE_MS = 8_000;
const AMOUNT = { cents: 100, currency: "USD" } as const;
const NOTE = "Kin sandbox probe: test money only.";

type Case = {
  readonly name: string;
  readonly build: (email: string) => NewPayout;
  /** A receiver Kin's adapter refuses to build, swapped into the body the adapter made for the same handle with its `@`. */
  readonly bareHandle?: string;
};

const CASES: readonly Case[] = [
  { name: "venmo-email", build: (email) => ({ ...base(), receiver: email, wallet: "VENMO" }) },
  { name: "venmo-handle-at", build: () => ({ ...base(), receiver: "@kin-probe-handle", wallet: "VENMO" }) },
  // Kin's adapter refuses a handle without its `@` today, so the body is the @-handle's with the receiver swapped.
  { name: "venmo-handle-bare", build: () => ({ ...base(), receiver: "@kin-probe-handle", wallet: "VENMO" }), bareHandle: "kin-probe-handle" },
  { name: "venmo-phone", build: () => ({ ...base(), receiver: "+15555550123", wallet: "VENMO" }) },
  { name: "paypal-control", build: (email) => ({ ...base(), receiver: email }) },
  // PayPal's negative-testing code goes in the note; documented for an email item only.
  { name: "venmo-forced-failure", build: (email) => ({ ...base(), receiver: email, wallet: "VENMO", note: "ERRPYO002" }) },
];

function bodyFor(each: Case, email: string): string {
  const body = payoutBody(each.build(email));
  if (each.bareHandle === undefined) return body;
  const parsed = JSON.parse(body) as { sender_batch_header: Record<string, unknown>; items: Record<string, unknown>[] };
  return JSON.stringify({ ...parsed, items: parsed.items.map((item) => ({ ...item, receiver: each.bareHandle })) });
}

function base(): Omit<NewPayout, "receiver"> {
  return { senderBatchId: `kin-venmo-probe-${randomUUID()}`, amount: AMOUNT, note: NOTE };
}

/** A refusal's raw body for a fixture: addresses masked and PayPal's debug ID replaced. */
function maskRaw(text: string): string {
  return mask(text).replace(/"debug_id":"[^"]*"/g, '"debug_id":"DEBUGID"');
}

function mask(text: string): string {
  return text.replace(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, (_match, domain: string) => `a***@${domain}`);
}

/** The body Kin would send, as the one-line summary this script prints: no batch ID, addresses masked. */
function shape(body: string): unknown {
  const parsed = JSON.parse(body) as { sender_batch_header: Record<string, unknown>; items: Record<string, unknown>[] };
  const header = { ...parsed.sender_batch_header, sender_batch_id: undefined };
  const items = parsed.items.map((item) => ({ ...item, sender_item_id: undefined }));
  return JSON.parse(mask(JSON.stringify({ sender_batch_header: header, items }))) as unknown;
}

type Answer = { readonly status: number; readonly json: Record<string, unknown>; readonly debugId: string | null };

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run through the package script so the repository's .env is loaded.`);
  return value;
}

function readJson(text: string): Record<string, unknown> {
  if (text === "") return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { unreadable: true };
  }
}

async function signIn(apiUrl: string): Promise<(method: "GET" | "POST", path: string, body?: string) => Promise<Answer>> {
  const settings = readPayPalConfig(process.env, { webhook: false });
  if (!settings.enabled) throw new Error("Set KIN_PAYPAL_CLIENT_ID and KIN_PAYPAL_CLIENT_SECRET in the repository's .env");
  const basic = Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString("base64");
  const tokenResponse = await fetch(`${apiUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const token = ((await tokenResponse.json()) as Record<string, unknown>)["access_token"];
  if (!tokenResponse.ok || typeof token !== "string") throw new Error(`Sign-in to the sandbox failed: HTTP ${tokenResponse.status}`);
  return async (method, path, body) => {
    const response = await fetch(`${apiUrl}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(20_000) });
    const text = await response.text();
    const json = readJson(text);
    return { status: response.status, json, debugId: response.headers.get("paypal-debug-id") };
  };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What PayPal said went wrong, never a whole response. */
function problem(answer: Answer): unknown {
  const json = answer.json;
  const details = Array.isArray(json["details"]) ? (json["details"] as Record<string, unknown>[]) : [];
  return JSON.parse(mask(JSON.stringify({ name: json["name"], message: json["message"], issues: details.map((each) => ({ issue: each["issue"], field: each["field"], description: each["description"] })), debugId: answer.debugId })));
}

function firstRecord(value: unknown): Record<string, unknown> {
  return Array.isArray(value) && typeof value[0] === "object" && value[0] !== null ? (value[0] as Record<string, unknown>) : {};
}

function itemSummary(json: Record<string, unknown>): Record<string, unknown> {
  const header = (json["batch_header"] ?? {}) as Record<string, unknown>;
  const item = firstRecord(json["items"]);
  const detail = (item["payout_item"] ?? {}) as Record<string, unknown>;
  const errors = (item["errors"] ?? null) as Record<string, unknown> | null;
  return {
    batchStatus: header["batch_status"],
    itemStatus: item["transaction_status"],
    recipientType: detail["recipient_type"],
    recipientWalletReturned: detail["recipient_wallet"] ?? null,
    itemError: errors ? JSON.parse(mask(JSON.stringify({ name: errors["name"], message: errors["message"] }))) : null,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const recordAt = argv.indexOf("--record");
  const recordFile = recordAt === -1 ? null : (argv[recordAt + 1] ?? null);
  if (recordAt !== -1 && recordFile === null) throw new Error("Pass a file after --record.");
  const args = recordAt === -1 ? argv : argv.filter((_each, index) => index !== recordAt && index !== recordAt + 1);
  const dry = args.includes("dry-run");
  const chosen = CASES.filter((each) => args.length === 0 || dry || args.includes(each.name));
  const unknown = args.filter((each) => each !== "dry-run" && !CASES.some((known) => known.name === each));
  if (unknown.length > 0) throw new Error(`Unknown case: ${unknown.join(", ")}`);

  const email = requiredEnv("EMAIL_PERSONAL_AMARA");
  const settings = readPayPalConfig(process.env, { webhook: false });
  // readPayPalConfig also refuses other hosts; this is the probe's own check.
  if (!settings.enabled || settings.apiUrl !== PAYPAL_SANDBOX_API) throw new Error("This probe sends only to PayPal's sandbox.");
  const apiUrl = settings.apiUrl;

  if (dry) {
    for (const each of chosen) console.log(JSON.stringify({ case: each.name, request: shape(bodyFor(each, email)) }));
    return;
  }

  const call = await signIn(apiUrl);
  const refusals: Record<string, unknown> = {};
  const created: { name: string; batchId: string }[] = [];
  for (const each of chosen) {
    const body = bodyFor(each, email);
    const answer = await call("POST", "/v1/payments/payouts", body);
    const header = (answer.json["batch_header"] ?? {}) as Record<string, unknown>;
    const batchId = typeof header["payout_batch_id"] === "string" ? header["payout_batch_id"] : null;
    console.log(JSON.stringify({ case: each.name, request: shape(body), createStatus: answer.status, ...(batchId === null ? { refused: problem(answer) } : { batchStatus: header["batch_status"] }) }));
    if (batchId !== null) created.push({ name: each.name, batchId });
    else refusals[each.name] = { httpStatus: answer.status, body: JSON.parse(maskRaw(JSON.stringify(answer.json))) as unknown };
    await pause(PAUSE_MS);
  }

  await pause(SETTLE_MS);
  for (const each of created) {
    const answer = await call("GET", `/v1/payments/payouts/${encodeURIComponent(each.batchId)}`);
    console.log(JSON.stringify({ case: each.name, readStatus: answer.status, ...(answer.status === 200 ? itemSummary(answer.json) : { refused: problem(answer) }) }));
    await pause(PAUSE_MS);
  }
  if (recordFile !== null) {
    writeFileSync(recordFile, `${JSON.stringify({ recordedOn: new Date().toISOString().slice(0, 10), refusals }, null, 2)}\n`);
    console.log(`Refusals written to ${recordFile}`);
  }
}

await main();