import { auditCsv } from "@/content/circle/audit-csv";
import { circleNames } from "@/content/circle/names";
import { openPeriod } from "@/content/circle/period";
import { getDictionary } from "@/i18n/dictionary";
import { isLocale } from "@/i18n/locales";
import { circleOf } from "@/server/circle";
import { may } from "@/server/dashboard-context";
import { currentViewer } from "@/server/viewer";

/**
 * The audit export: the record with each entry's ID and the evidence behind
 * it. The viewer and their role are checked here, as on every screen.
 */
export async function GET(_: Request, { params }: RouteContext<"/[locale]/dashboard/record/audit">): Promise<Response> {
  const { locale } = await params;
  if (!isLocale(locale)) return new Response(null, { status: 404 });
  const viewer = await currentViewer();
  if (viewer === null) return new Response(null, { status: 401 });
  const circle = await circleOf(viewer);
  if (circle === null || !may(circle, "money.view")) return new Response(null, { status: 403 });
  const dictionary = await getDictionary(locale);
  return new Response(auditCsv(circle, dictionary, circleNames(circle, dictionary)), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="kin-audit-${openPeriod(circle)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
