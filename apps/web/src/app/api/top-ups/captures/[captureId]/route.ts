import { asPerson, contributionRecorded } from "@kin/db";
import { isPayPalId } from "@kin/paypal";

import { databases } from "@/server/database";
import { may } from "@/server/dashboard-context";
import { json, topUpRequest } from "@/server/top-up-request";

/**
 * Whether the circle's ledger holds a capture yet: the page asks until the
 * worker has recorded it. Read as the viewer, so row-level security decides.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/top-ups/captures/[captureId]">): Promise<Response> {
  const { captureId } = await params;
  if (!isPayPalId(captureId)) return json({ recorded: false }, 404);
  const checked = await topUpRequest(request);
  if (checked instanceof Response) return checked;
  const { viewer, circle } = checked;
  if (!may(circle, "money.contribute")) return json({ error: "role" }, 403);
  const recorded = await asPerson(databases().app, viewer.userId, (tx) => contributionRecorded(tx, circle.circle.id, captureId));
  return json({ recorded });
}
