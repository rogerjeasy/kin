import { getDictionary } from "@/i18n/dictionary";
import { defaultLocale, isLocale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { fill } from "@/i18n/template";
import { authConfig } from "@/server/auth/config";
import { readCappedText } from "@/server/request-body";
import { startTopUp } from "@/server/top-ups";
import { json, topUpRequest } from "@/server/top-up-request";

const MAX_BODY = 1_000;

/** Opens a PayPal order for the viewer's top-up: `{ amount: "25.00", locale }` → `{ orderId }`. */
export async function POST(request: Request): Promise<Response> {
  const checked = await topUpRequest(request);
  if (checked instanceof Response) return checked;
  const body = await readBody(request);
  if (body === null) return json({ error: "amount" }, 400);
  const locale = typeof body["locale"] === "string" && isLocale(body["locale"]) ? body["locale"] : defaultLocale;
  const dictionary = await getDictionary(locale);
  const result = await startTopUp(checked.services, checked.circle, {
    amount: body["amount"],
    returnUrl: new URL(localizedPath(locale, dashboardRoutes.overview), authConfig().webOrigin).toString(),
    description: fill(dictionary.dashboard.topUp.orderDescription, { circle: checked.circle.circle.name }),
  });
  if (!result.ok) return json({ error: result.reason }, result.reason === "role" ? 403 : result.reason === "paypal" ? 502 : 400);
  return json({ orderId: result.orderId });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const text = await readCappedText(request, MAX_BODY);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
