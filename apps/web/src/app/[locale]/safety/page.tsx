import type { Metadata } from "next";

import { ContentSection } from "@/components/pages/content-section";
import { PageHero } from "@/components/pages/page-hero";
import { ClosingBand } from "@/components/shared/closing-band";
import { FeatureList } from "@/components/shared/feature-list";
import { RecordTrace } from "@/components/shared/record-trace";
import { SpokenLines } from "@/components/shared/spoken-lines";
import { exampleAmounts } from "@/content/example-amounts";
import { pageContext, pageMetadata } from "@/i18n/page-context";

export function generateMetadata({ params }: PageProps<"/[locale]/safety">): Promise<Metadata> {
  return pageMetadata(params, "safety");
}

export default async function SafetyPage({ params }: PageProps<"/[locale]/safety">) {
  const { locale, dictionary } = await pageContext(params);
  const { hero, limits, guard, scam, trust } = dictionary.safetyPage;
  const { people } = dictionary.common;

  return (
    <>
      <PageHero eyebrow={hero.eyebrow} title={hero.title} lede={hero.lede} />
      <ContentSection id="limits" eyebrow={limits.eyebrow} title={limits.title}>
        <FeatureList items={limits.items} columns="three" />
      </ContentSection>
      <ContentSection id="guard" tone="muted" eyebrow={guard.eyebrow} title={guard.title} lede={guard.text}>
        <RecordTrace
          copy={dictionary.trace}
          spoken={dictionary.home.hero.spokenAmount}
          amount={exampleAmounts(locale).bill}
        />
      </ContentSection>
      <ContentSection id="scam" eyebrow={scam.eyebrow} title={scam.title} lede={scam.text}>
        <div className="max-w-3xl rounded-3xl border bg-card p-6 sm:p-9">
          <SpokenLines
            lines={[
              { speaker: people.rose, text: scam.roseLine, voice: "person" },
              { speaker: people.kin, text: scam.kinLine, voice: "kin" },
            ]}
          />
        </div>
        <p className="mt-8 max-w-2xl text-lg text-muted-foreground">{scam.rule}</p>
      </ContentSection>
      <ContentSection id="trust" tone="muted" eyebrow={trust.eyebrow} title={trust.title}>
        <FeatureList items={trust.items} />
      </ContentSection>
      <ClosingBand locale={locale} title={dictionary.home.closing.title} nav={dictionary.common.nav} />
    </>
  );
}
