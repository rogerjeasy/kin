import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { NoteCard } from "@/components/pages/note-card";
import { PageHero } from "@/components/pages/page-hero";
import { PlanList } from "@/components/pages/plan-list";
import { ClosingBand } from "@/components/shared/closing-band";
import { pageContext, pageMetadata } from "@/i18n/page-context";

export function generateMetadata({ params }: PageProps<"/[locale]/pricing">): Promise<Metadata> {
  return pageMetadata(params, "pricing");
}

export default async function PricingPage({ params }: PageProps<"/[locale]/pricing">) {
  const { locale, dictionary } = await pageContext(params);
  const { hero, notice, plans, split } = dictionary.pricingPage;

  return (
    <>
      <PageHero eyebrow={hero.eyebrow} title={hero.title} lede={hero.lede} />
      <div className="py-12 sm:py-16 lg:py-20">
        <Container className="space-y-12 lg:space-y-16">
          <NoteCard title={notice.title} text={notice.text} />
          <PlanList copy={plans} />
          <NoteCard title={split.title} text={split.text} />
        </Container>
      </div>
      <ClosingBand locale={locale} title={dictionary.home.closing.title} nav={dictionary.common.nav} />
    </>
  );
}
