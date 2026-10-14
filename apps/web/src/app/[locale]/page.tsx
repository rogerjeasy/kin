import type { Metadata } from "next";

import { AudienceSection } from "@/components/home/audience-section";
import { CircleSection } from "@/components/home/circle-section";
import { HeroSection } from "@/components/home/hero-section";
import { MonthSection } from "@/components/home/month-section";
import { ProofStrip } from "@/components/home/proof-strip";
import { SafetySection } from "@/components/home/safety-section";
import { VoiceSection } from "@/components/home/voice-section";
import { ClosingBand } from "@/components/shared/closing-band";
import { exampleAmounts } from "@/content/example-amounts";
import { routes } from "@/content/site-routes";
import { pageContext, pageMetadata } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";

export function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  return pageMetadata(params, "home");
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale, dictionary } = await pageContext(params);
  const { home, common, trace } = dictionary;
  const amounts = exampleAmounts(locale);

  return (
    <>
      <HeroSection locale={locale} copy={home.hero} nav={common.nav} limit={amounts.limit} />
      <ProofStrip copy={home.proof} />
      <CircleSection locale={locale} copy={home.circle} common={common} amounts={amounts} />
      <VoiceSection copy={home.voice} people={common.people} />
      <MonthSection copy={home.month} href={localizedPath(locale, routes.howItWorks)} />
      <SafetySection
        copy={home.safety}
        trace={trace}
        spoken={home.hero.spokenAmount}
        amount={amounts.bill}
        href={localizedPath(locale, routes.safety)}
      />
      <AudienceSection locale={locale} copy={home.audience} />
      <ClosingBand locale={locale} title={home.closing.title} nav={common.nav} />
    </>
  );
}
