import { isPayPalId } from "@kin/paypal";

import { confirmTopUp } from "@/server/top-ups";
import { json, topUpRequest } from "@/server/top-up-request";

/** Captures an order the payer approved in PayPal: → `{ captureId }`, confirmed later by the worker. */
export async function POST(request: Request, { params }: RouteContext<"/api/top-ups/[orderId]/capture">): Promise<Response> {
  const { orderId } = await params;
  if (!isPayPalId(orderId)) return json({ error: "not_yours" }, 404);
  const checked = await topUpRequest(request);
  if (checked instanceof Response) return checked;
  const result = await confirmTopUp(checked.services, checked.circle, orderId);
  if (!result.ok) return json({ error: result.reason }, result.reason === "role" ? 403 : result.reason === "not_yours" ? 404 : 422);
  return json({ captureId: result.captureId });
}
