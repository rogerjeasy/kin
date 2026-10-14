import type { Metadata } from "next";

import { CapabilityGrid } from "@/components/how-it-works/capability-grid";
import { CastCard } from "@/components/how-it-works/cast-card";
import { CheckList } from "@/components/how-it-works/check-list";
import { HeroFacts } from "@/components/how-it-works/hero-facts";
import { Timeline } from "@/components/how-it-works/timeline";
import { ContentSection } from "@/components/pages/content-section";
import { PageHero } from "@/components/pages/page-hero";
import { RelatedPages } from "@/components/pages/related-pages";
import { ClosingBand } from "@/components/shared/closing-band";
import { Tag } from "@/components/shared/tag";
import { exampleAmounts } from "@/content/example-amounts";
import { pageContext, pageMetadata } from "@/i18n/page-context";

export function generateMetadata({ params }: PageProps<"/[locale]/how-it-works">): Promise<Metadata> {
  return pageMetadata(params, "howItWorks");
}

export default async function HowItWorksPage({ params }: PageProps<"/[locale]/how-it-works">) {
  const { locale, dictionary } = await pageContext(params);
  const { hero, cast, timeline, paypal, ai } = dictionary.howItWorks;
  const { common, home } = dictionary;

  return (
    <>
      <PageHero
        eyebrow={hero.eyebrow}
        title={hero.title}
        lede={hero.lede}
        aside={<CastCard copy={cast} people={common.people} limit={exampleAmounts(locale).limit} />}
      >
        <HeroFacts facts={hero.facts} />
      </PageHero>
      <Timeline locale={locale} copy={timeline} people={common.people} moments={home.month.moments} />
      <ContentSection id="paypal" tone="muted" eyebrow={paypal.eyebrow} title={paypal.title} lede={paypal.lede}>
        <CapabilityGrid copy={paypal} />
        <Tag className="mt-6">{common.example.sandbox}</Tag>
      </ContentSection>
      <ContentSection id="ai" eyebrow={ai.eyebrow} title={ai.title} lede={ai.closing}>
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
          <CheckList title={ai.doesTitle} items={ai.does} kind="does" />
          <CheckList title={ai.doesNotTitle} items={ai.doesNot} kind="doesNot" />
        </div>
      </ContentSection>
      <RelatedPages locale={locale} dictionary={dictionary} current="howItWorks" />
      <ClosingBand locale={locale} title={home.closing.title} nav={common.nav} current="howItWorks" />
    </>
  );
}
