import { createServer } from "node:http";

import { BODY_LIMIT, handle } from "./handler.ts";
import { createOrderBook } from "./orders.ts";
import { paypalSavedWallet, simulatedWallet } from "./wallet.ts";

/**
 * The demo pharmacy as its own small service, so the hackathon can show a
 * whole purchase. With `KIN_MERCHANT_PAYPAL_*` set it charges the pool's saved
 * sandbox wallet; without them it charges nothing and says so. Either way it
 * is a stand-in and labels itself one.
 */
const env = process.env;
const clientId = env["KIN_MERCHANT_PAYPAL_CLIENT_ID"];
const clientSecret = env["KIN_MERCHANT_PAYPAL_CLIENT_SECRET"];
const vaultId = env["KIN_MERCHANT_PAYPAL_VAULT_ID"];
const live = clientId !== undefined && clientSecret !== undefined && vaultId !== undefined;
const wallet = live ? paypalSavedWallet({ baseUrl: env["KIN_MERCHANT_PAYPAL_URL"] ?? "https://api-m.sandbox.paypal.com", clientId, clientSecret, vaultId }) : simulatedWallet;
const book = createOrderBook({ wallet, now: () => new Date() });
const port = Number(env["PORT"] ?? 4100);

createServer(async (request, response) => {
  const reply = async () => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > BODY_LIMIT) return { status: 413, body: { error: "too_large" } };
      chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    let body: unknown = null;
    if (text !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        return { status: 400, body: { error: "invalid_json" } };
      }
    }
    return handle(book, { method: request.method ?? "GET", path: new URL(request.url ?? "/", "http://pharmacy.local").pathname, body });
  };
  try {
    const { status, body } = await reply();
    response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  } catch {
    // Never a stack trace or a provider's message in a response (AGENTS.md section 6).
    response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "unavailable" }));
  }
}).listen(port, () => console.log(JSON.stringify({ at: new Date().toISOString(), level: "info", message: "demo_merchant.started", port, wallet: live ? "paypal_sandbox" : "simulated" })));
