import { dashboardRoutes } from "@/content/dashboard-routes";
import { getDictionary } from "@/i18n/dictionary";
import { defaultLocale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { authConfig } from "@/server/auth/config";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { runMonthlyShare } from "@/server/monthly-shares";
import { topUpServices } from "@/server/paypal";

const MAX_BODY = 1_000;

/** The viewer's own monthly share: `{ operation: "start", amount }`, or `pause`, `resume`, `cancel`, `check`. */
export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_BODY, label: "monthly_share" }, async ({ viewer, circle }, input) => {
    const dictionary = await getDictionary(defaultLocale);
    // PayPal returns the member to the circle's screen, which then reads the share back.
    const returnUrl = new URL(`${localizedPath(defaultLocale, dashboardRoutes.circle)}?monthly=back`, authConfig().webOrigin).toString();
    return runMonthlyShare(
      {
        db: databases().app,
        userId: viewer.userId,
        circle,
        services: topUpServices(),
        returnUrl,
        description: fill(dictionary.dashboard.monthly.description, { circle: circle.circle.name }),
      },
      input,
    );
  });
}
