import type { Metadata } from "next";

import { InsetSection } from "@/components/layout/inset-section";
import { Section } from "@/components/layout/section";
import { PageHero } from "@/components/pages/page-hero";
import { RelatedPages } from "@/components/pages/related-pages";
import { FaqSection } from "@/components/pricing/faq-section";
import { FeeSplit } from "@/components/pricing/fee-split";
import { PlanCards } from "@/components/pricing/plan-cards";
import { PlanList } from "@/components/pricing/plan-list";
import { ClosingBand } from "@/components/shared/closing-band";
import { StatusNote } from "@/components/shared/status-note";
import { pageContext, pageMetadata } from "@/i18n/page-context";

export function generateMetadata({ params }: PageProps<"/[locale]/pricing">): Promise<Metadata> {
  return pageMetadata(params, "pricing");
}

export default async function PricingPage({ params }: PageProps<"/[locale]/pricing">) {
  const { locale, dictionary } = await pageContext(params);
  const { hero, notice, plans, split, faq } = dictionary.pricingPage;
  const { common, home } = dictionary;

  return (
    <>
      <PageHero eyebrow={hero.eyebrow} title={hero.title} lede={hero.lede}>
        <StatusNote title={notice.title} text={notice.text} />
      </PageHero>
      <Section>
        <PlanCards
          locale={locale}
          copy={plans}
          startLabel={common.nav.startLong}
          caregiversLabel={home.audience.caregivers.link}
        />
        <div className="mt-16 lg:mt-24">
          <PlanList copy={plans} />
        </div>
      </Section>
      <InsetSection tone="muted">
        <FeeSplit locale={locale} copy={split} people={common.people} />
      </InsetSection>
      <FaqSection copy={faq} />
      <RelatedPages locale={locale} dictionary={dictionary} current="pricing" />
      <ClosingBand locale={locale} title={home.closing.title} nav={common.nav} />
    </>
  );
}
