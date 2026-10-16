import { webhookHeaders } from "@kin/paypal";

import { topUpServices } from "@/server/paypal";
import { readCappedText } from "@/server/request-body";

/** PayPal's events are a few kilobytes. Anything far larger is not one. */
const MAX_BODY = 64 * 1024;

/**
 * PayPal's webhook. It does the least that is safe: it passes the delivery,
 * byte for byte with its signature headers, to the worker's queue and says
 * 200 once the queue holds it. The worker stores it, verifies the signature
 * with PayPal and reads the resource back before any money is recorded
 * (docs/architecture.md section 8.7). No session: the signature is the proof.
 */
export async function POST(request: Request): Promise<Response> {
  const services = topUpServices();
  if (services === null) return new Response(null, { status: 404 });
  const headers = webhookHeaders((name) => request.headers.get(name));
  if (headers === null) return new Response(null, { status: 400 });
  const body = await readCappedText(request, MAX_BODY);
  if (body === null) return new Response(null, { status: 413 });
  if (body === "") return new Response(null, { status: 400 });
  try {
    await services.inbox.send({ kind: "webhook", delivery: { body, headers } });
  } catch {
    // Not held, so not acknowledged: PayPal delivers it again, for up to three days.
    return new Response(null, { status: 503 });
  }
  return new Response(null, { status: 200 });
}
