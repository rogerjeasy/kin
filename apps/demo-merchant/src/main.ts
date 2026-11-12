import { createServer } from "node:http";

import { readMerchantServiceConfig } from "@kin/config";

import { MERCHANT_SIGNATURE_HEADER, clientAddress, createGate, fixedWindowLimiter } from "./gate.ts";
import { BODY_LIMIT } from "./handler.ts";
import { createOrderBook } from "./orders.ts";
import { paypalSavedWallet, simulatedWallet } from "./wallet.ts";

/**
 * The demo pharmacy as its own small service, so the hackathon can show a
 * whole purchase. With `KIN_MERCHANT_PAYPAL_*` set it charges Rose's saved
 * payment method through its own PayPal sandbox app; without them it charges
 * nothing and says so. Either way it is a stand-in and labels itself one, and
 * it answers only requests Kin's worker signed (`KIN_DEMO_MERCHANT_SIGNING_SECRET`).
 */
const config = readMerchantServiceConfig(process.env);
const now = () => new Date();
const wallet = config.wallet.kind === "paypal_sandbox" ? paypalSavedWallet(config.wallet) : simulatedWallet;
const book = createOrderBook({ wallet, now, chargesPerDay: config.chargesPerDay });
// The worker sends a handful of signed requests a minute, in a bucket of their own. Unsigned ones are
// refused whatever happens; the small per-address limit only stops a flood of them sooner.
const gate = createGate({
  book,
  signingSecret: config.signingSecret,
  unsigned: fixedWindowLimiter({ limit: 30, windowMs: 60_000, now }),
  signed: fixedWindowLimiter({ limit: 300, windowMs: 60_000, now }),
  now,
});
const port = Number(process.env["PORT"] ?? 4100);

const single = (value: string | string[] | undefined): string | null => (typeof value === "string" ? value : null);

createServer(async (request, response) => {
  const reply = async () => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > BODY_LIMIT) return { status: 413, body: { error: "too_large" } };
      chunks.push(chunk as Buffer);
    }
    return gate({
      method: request.method ?? "GET",
      target: request.url ?? "/",
      signature: single(request.headers[MERCHANT_SIGNATURE_HEADER]),
      rawBody: Buffer.concat(chunks).toString("utf8"),
      client: clientAddress(single(request.headers["x-forwarded-for"]), request.socket.remoteAddress),
    });
  };
  try {
    const { status, body } = await reply();
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
  } catch {
    // Never a stack trace or a provider's message in a response (AGENTS.md section 6).
    response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "unavailable" }));
  }
}).listen(port, () => console.log(JSON.stringify({ at: new Date().toISOString(), level: "info", message: "demo_merchant.started", port, wallet: config.wallet.kind, chargesPerDay: config.chargesPerDay })));
