import type { Metadata } from "next";

import { CapabilityTable } from "@/components/pages/capability-table";
import { CheckList } from "@/components/pages/check-list";
import { ContentSection } from "@/components/pages/content-section";
import { PageHero } from "@/components/pages/page-hero";
import { Timeline } from "@/components/pages/timeline";
import { ClosingBand } from "@/components/shared/closing-band";
import { pageContext, pageMetadata } from "@/i18n/page-context";

export function generateMetadata({ params }: PageProps<"/[locale]/how-it-works">): Promise<Metadata> {
  return pageMetadata(params, "howItWorks");
}

export default async function HowItWorksPage({ params }: PageProps<"/[locale]/how-it-works">) {
  const { locale, dictionary } = await pageContext(params);
  const { hero, timeline, paypal, ai } = dictionary.howItWorks;

  return (
    <>
      <PageHero eyebrow={hero.eyebrow} title={hero.title} lede={hero.lede} />
      <Timeline copy={timeline} />
      <ContentSection id="paypal" tone="muted" eyebrow={paypal.eyebrow} title={paypal.title} lede={paypal.lede}>
        <CapabilityTable copy={paypal} />
      </ContentSection>
      <ContentSection id="ai" eyebrow={ai.eyebrow} title={ai.title}>
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
          <CheckList title={ai.doesTitle} items={ai.does} kind="does" />
          <CheckList title={ai.doesNotTitle} items={ai.doesNot} kind="doesNot" />
        </div>
        <p className="mt-8 max-w-2xl text-lg text-muted-foreground">{ai.closing}</p>
      </ContentSection>
      <ClosingBand locale={locale} title={dictionary.home.closing.title} nav={dictionary.common.nav} />
    </>
  );
}
