import { readInboxConfig, readPayPalConfig } from "@kin/config";
import { poolFor, sqsInbox, type Inbox, type PayPalPool } from "@kin/paypal";

/** Where the browser loads PayPal's JavaScript SDK v6 from: the sandbox's. */
export const PAYPAL_SDK_URL = "https://www.sandbox.paypal.com/web-sdk/v6/core";

/** What the top-up routes need: the pool account and the queue to the worker. */
export type TopUpServices = { readonly pool: PayPalPool; readonly inbox: Inbox; readonly clientId: string };

let services: TopUpServices | null | undefined;

/**
 * The top-up services, or `null` when this deployment has no PayPal app or
 * no queue. Without the queue no top-up could ever be confirmed, so the
 * feature is off rather than half on. Read on first use, never at build time.
 */
export function topUpServices(): TopUpServices | null {
  if (services === undefined) {
    const paypal = readPayPalConfig(process.env, { webhook: false });
    const inbox = readInboxConfig(process.env);
    services =
      paypal.enabled && inbox !== null
        ? {
            pool: poolFor(paypal, (call) => {
              // PayPal's debug ID, so a failed call can be raised with PayPal. Never a body or token.
              if (call.status === null || call.status >= 400) console.error(JSON.stringify({ message: "paypal.call", ...call }));
            }),
            inbox: sqsInbox(inbox),
            clientId: paypal.clientId,
          }
        : null;
  }
  return services;
}
