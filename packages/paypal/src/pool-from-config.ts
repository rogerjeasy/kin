import { createPayPalClient, type PayPalCallLog } from "./client.ts";
import { paypalPool, type PayPalPool } from "./pool.ts";

type Settings = { readonly apiUrl: string; readonly clientId: string; readonly clientSecret: string; readonly webhookId: string | null };

/**
 * The circle's pool account. In the hackathon every circle's pool is the one
 * sandbox business account in the settings, and each order names its circle
 * in `custom_id`. In production each family's own account would be reached
 * through PayPal's partner model (docs/architecture.md section 8.1); only
 * this function would change.
 */
export function poolFor(settings: Settings, log: (call: PayPalCallLog) => void = () => undefined): PayPalPool {
  const client = createPayPalClient({
    apiUrl: settings.apiUrl,
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log,
  });
  return paypalPool(client, settings.webhookId ?? "");
}
