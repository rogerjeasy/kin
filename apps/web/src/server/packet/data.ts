import { asPerson, readExecutions, type CircleSnapshot } from "@kin/db";
import { verifyBundle, type AuditBundle, type VerificationReport } from "@kin/verify";

import { circleBundle } from "@/content/circle/audit-bundle";
import { circleFormatters } from "@/content/circle/format";
import { lookbackView, type LookbackView } from "@/content/circle/lookback";
import { circleNames } from "@/content/circle/names";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { keepHead, keptHeads } from "@/server/audit-heads";
import { databases } from "@/server/database";

export type PacketData = {
  readonly view: LookbackView;
  readonly bundle: AuditBundle;
  readonly report: VerificationReport;
};

/**
 * What the screen and the download both stand on: the look-back worked out
 * from the circle's record and the executions that tie each payment to its
 * visit, bill or order, and the audit bundle checked again just now. One
 * function, so what the page shows is exactly what the packet holds.
 */
export async function packetData(input: { readonly userId: string; readonly circle: CircleSnapshot; readonly locale: Locale; readonly dictionary: Dictionary; readonly keepAs: "verify" | "export" }): Promise<PacketData> {
  const { userId, circle, locale, dictionary, keepAs } = input;
  const db = databases().app;
  const executions = await asPerson(db, userId, (tx) => readExecutions(tx, circle.circle.id));
  const bundle = circleBundle(circle, dictionary, circleNames(circle, dictionary), circleFormatters(locale, circle), await keptHeads(db, userId, circle));
  const report = verifyBundle(bundle);
  // Kept after the check, so what was just checked stood against earlier heads only.
  await keepHead(db, userId, circle, bundle, keepAs);
  return { view: lookbackView(circle, executions), bundle, report };
}
