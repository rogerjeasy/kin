// Subscribes the pool's PayPal sandbox app to the events Kin applies, at the
// web app's webhook address (creating it, or adding any event it lacks), and prints the webhook's ID for infra/cdk.json
// (kin:paypal.webhookId). Running it again finds the webhook it made.
//
//   pnpm --filter @kin/paypal run webhook:register -- https://<web app>/api/paypal/webhook
import { readPayPalConfig } from "@kin/config";

import { createPayPalClient } from "../src/client.ts";
import { asRecord, optionalText, recordList } from "../src/json.ts";
import { WEBHOOK_EVENT_TYPES } from "../src/webhook.ts";

const url = process.argv.at(-1) ?? "";
if (!/^https:\/\/[^/]+\/api\/paypal\/webhook$/.test(url)) {
  throw new Error("Give the web app's webhook address: https://<host>/api/paypal/webhook (PayPal only calls https)");
}
const settings = readPayPalConfig(process.env, { webhook: false });
if (!settings.enabled) throw new Error("Set KIN_PAYPAL_CLIENT_ID and KIN_PAYPAL_CLIENT_SECRET in the repository's .env");

const client = createPayPalClient({
  ...settings,
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (call) => console.log(`${call.operation}: HTTP ${call.status ?? "no answer"} (debug ID ${call.debugId ?? "none"})`),
});

const existing = recordList(asRecord(await client.send({ method: "GET", path: "/v1/notifications/webhooks", operation: "webhooks.list" }), "webhooks")["webhooks"]);
const found = existing.find((webhook) => optionalText(webhook, "url") === url);
const webhook =
  found ??
  asRecord(
    await client.send({
      method: "POST",
      path: "/v1/notifications/webhooks",
      body: JSON.stringify({ url, event_types: WEBHOOK_EVENT_TYPES.map((name) => ({ name })) }),
      requestId: `kin-webhook-${url}`,
      operation: "webhooks.create",
    }),
    "webhook",
  );
const subscribed = found === undefined ? [] : recordList(found["event_types"]).flatMap((type) => optionalText(type, "name") ?? []);
const missing = WEBHOOK_EVENT_TYPES.filter((name) => !subscribed.includes(name));
// An existing webhook keeps the events it was made with, so one made before a new event was added is brought up to date.
if (found !== undefined && missing.length > 0) {
  await client.send({
    method: "PATCH",
    path: `/v1/notifications/webhooks/${optionalText(found, "id") ?? ""}`,
    body: JSON.stringify([{ op: "replace", path: "/event_types", value: [...new Set([...subscribed, ...WEBHOOK_EVENT_TYPES])].map((name) => ({ name })) }]),
    requestId: `kin-webhook-events-${url}-${missing.join(",")}`,
    operation: "webhooks.update",
  });
  console.log(`Subscribed the webhook to: ${missing.join(", ")}`);
}
console.log(`\n${found ? (missing.length > 0 ? "Updated" : "Found") : "Created"} the webhook for ${url}.\nPut this in infra/cdk.json under kin:paypal.webhookId: ${optionalText(webhook, "id") ?? "(no ID returned)"}`);
