import { circleBundle } from "@/content/circle/audit-bundle";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { openPeriod } from "@/content/circle/period";
import { getDictionary } from "@/i18n/dictionary";
import { isLocale } from "@/i18n/locales";
import { circleOf } from "@/server/circle";
import { may } from "@/server/dashboard-context";
import { currentViewer } from "@/server/viewer";

/**
 * The verifiable export: the record with its hash chain, as JSON for the
 * `kin-verify` command. The viewer and their role are checked here, as on
 * every screen.
 */
export async function GET(_: Request, { params }: RouteContext<"/[locale]/dashboard/record/verify/export">): Promise<Response> {
  const { locale } = await params;
  if (!isLocale(locale)) return new Response(null, { status: 404 });
  const viewer = await currentViewer();
  if (viewer === null) return new Response(null, { status: 401 });
  const circle = await circleOf(viewer);
  if (circle === null || !may(circle, "money.view")) return new Response(null, { status: 403 });
  const dictionary = await getDictionary(locale);
  const bundle = circleBundle(circle, dictionary, circleNames(circle, dictionary), circleFormatters(locale, circle));
  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="kin-record-${openPeriod(circle)}.json"`,
      "cache-control": "no-store",
    },
  });
}
