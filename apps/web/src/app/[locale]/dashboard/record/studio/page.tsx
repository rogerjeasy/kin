import { KIN_LEAD_NOTE, KIN_RECORD_AGENT_DESCRIPTION, KIN_RECORD_AGENT_INSTRUCTIONS, KIN_RECORD_TOOL, KIN_RECORD_TOOL_DESCRIPTION } from "@kin/agent";
import { readModelConfig } from "@kin/config";
import type { Metadata } from "next";

import { StudioSurface } from "@/components/dashboard/studio/studio-surface";
import { StudioSummary } from "@/components/dashboard/studio/studio-summary";
import { studioFacts } from "@/components/dashboard/studio/studio-facts";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { studioData, studioTotals } from "@/content/circle/studio-data";
import { directionOf } from "@/i18n/locales";
import { pageContext } from "@/i18n/page-context";
import { dashboardContext } from "@/server/dashboard-context";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/record/studio">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, lede } = dictionary.dashboard.studio;
  return { title, description: lede, robots: { index: false, follow: false } };
}

/**
 * The family money studio: the circle's record as an AG Studio dashboard.
 * Whoever may open the Record may open it (a caregiver is sent to their own
 * screens), and it holds the same entries. The server builds every row and
 * every figure; the browser only draws them.
 */
export default async function StudioPage({ params }: PageProps<"/[locale]/dashboard/record/studio">) {
  const { locale, dictionary, circle } = await dashboardContext(params, "record");
  const copy = dictionary.dashboard.studio;
  const format = circleFormatters(locale, circle);
  const data = studioData(circle, dictionary, circleNames(circle, dictionary));
  const totals = studioTotals(data.ledger);
  const readOnly = circle.viewer.role === "observer";
  const agents = readModelConfig(process.env).enabled
    ? {
        instructions: KIN_RECORD_AGENT_INSTRUCTIONS,
        toolName: KIN_RECORD_TOOL,
        toolDescription: KIN_RECORD_TOOL_DESCRIPTION,
        kinDescription: KIN_RECORD_AGENT_DESCRIPTION,
        leadNote: KIN_LEAD_NOTE,
        facts: studioFacts(copy, totals, data.fairness, format),
      }
    : null;

  return (
    <>
      <PageHeader eyebrow={copy.eyebrow} title={copy.title} lede={readOnly ? `${copy.lede} ${copy.readOnly}` : copy.lede} />
      <StudioSurface data={data} copy={copy} locale={locale} timeZone={circle.circle.timezone} rtl={directionOf(locale) === "rtl"} readOnly={readOnly} agents={agents}>
        <StudioSummary copy={copy} totals={totals} fairness={data.fairness} format={format} />
      </StudioSurface>
    </>
  );
}
