import { circleNames } from "@/content/circle/names";
import { circleToday } from "@/content/circle/today";
import { getDictionary } from "@/i18n/dictionary";
import { isLocale } from "@/i18n/locales";
import { circleOf } from "@/server/circle";
import { may } from "@/server/dashboard-context";
import { buildPacket } from "@/server/packet/files";
import { packetData } from "@/server/packet/data";
import { packetNote } from "@/server/packet/note";
import { paymentProofs } from "@/server/packet/payment-proofs";
import { currentViewer } from "@/server/viewer";

/**
 * The packet for the family's attorney, as one ZIP. The viewer and their role
 * are checked here, as on every screen. The packet is written in English, the
 * language an attorney reads, whatever language the family's screens use.
 */
export async function GET(request: Request, { params }: RouteContext<"/[locale]/dashboard/record/packet/export">): Promise<Response> {
  const { locale } = await params;
  if (!isLocale(locale)) return new Response(null, { status: 404 });
  const viewer = await currentViewer();
  if (viewer === null) return new Response(null, { status: 401 });
  const circle = await circleOf(viewer);
  if (circle === null || !may(circle, "money.view")) return new Response(null, { status: 403 });
  const english = await getDictionary("en");
  const { view, bundle, report } = await packetData({ userId: viewer.userId, circle, locale: "en", dictionary: english, keepAs: "export" });
  const note = await packetNote(view, { currency: circle.circle.currency, chainOk: report.ok }, { asked: new URL(request.url).searchParams.get("note") === "1", userId: viewer.userId, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes });
  const proofs = await paymentProofs(circle, view);
  const { zip, fileName } = buildPacket({ circle, dictionary: english, names: circleNames(circle, english), view, bundle, report, note, proofs }, circleToday(circle), circle.circle.now);
  return new Response(Buffer.from(zip), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${fileName}"`, "cache-control": "no-store" },
  });
}
