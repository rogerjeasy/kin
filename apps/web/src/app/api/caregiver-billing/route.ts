import { revalidatePath } from "next/cache";

import { authConfig } from "@/server/auth/config";
import { runCaregiverBilling } from "@/server/caregiver-billing";
import { circleOf } from "@/server/circle";
import { databases } from "@/server/database";
import { readCappedText } from "@/server/request-body";
import { currentViewer } from "@/server/viewer";

const MAX_BILL_BYTES = 32_768;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("origin") !== authConfig().webOrigin) return json({ ok: false, reason: "refused" }, 403);
  const viewer = await currentViewer();
  if (viewer === null) return json({ ok: false, reason: "refused" }, 401);
  const circle = await circleOf(viewer);
  if (circle === null) return json({ ok: false, reason: "refused" }, 403);
  const text = await readCappedText(request, MAX_BILL_BYTES);
  if (text === null) return json({ ok: false, reason: "invalid" }, 413);
  let input: unknown;
  try { input = JSON.parse(text); } catch { return json({ ok: false, reason: "invalid" }, 400); }
  try {
    const result = await runCaregiverBilling({ db: databases().app, userId: viewer.userId, circle, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes }, input);
    if (result.ok) revalidatePath("/[locale]/dashboard", "layout");
    return json(result, result.ok ? 200 : result.reason === "refused" ? 403 : 400);
  } catch (error) {
    console.error(JSON.stringify({ message: "caregiver_billing.unavailable", error: error instanceof Error ? error.name : "unknown" }));
    return json({ ok: false, reason: "unavailable" }, 503);
  }
}
