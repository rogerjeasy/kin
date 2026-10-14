import { CirclePauseIcon, HistoryIcon, LockIcon, MegaphoneIcon, ShieldAlertIcon, UsersIcon } from "lucide-react";
import type { Metadata } from "next";

import { ContentSection } from "@/components/pages/content-section";
import { IconCardGrid } from "@/components/pages/icon-card-grid";
import { PageHero } from "@/components/pages/page-hero";
import { RelatedPages } from "@/components/pages/related-pages";
import { GuardDemo } from "@/components/safety/guard-demo";
import { ScamCheck } from "@/components/safety/scam-check";
import { SecretsRule } from "@/components/safety/secrets-rule";
import { ClosingBand } from "@/components/shared/closing-band";
import { FeatureList } from "@/components/shared/feature-list";
import { PrincipleChain } from "@/components/shared/principle-chain";
import { exampleAmounts } from "@/content/example-amounts";
import { pageContext, pageMetadata } from "@/i18n/page-context";

const safeguardIcons = {
  drain: LockIcon,
  approvals: UsersIcon,
  announced: MegaphoneIcon,
  pause: CirclePauseIcon,
  pressure: ShieldAlertIcon,
  history: HistoryIcon,
} as const;

const safeguardOrder = ["drain", "approvals", "announced", "pause", "pressure", "history"] as const;

export function generateMetadata({ params }: PageProps<"/[locale]/safety">): Promise<Metadata> {
  return pageMetadata(params, "safety");
}

export default async function SafetyPage({ params }: PageProps<"/[locale]/safety">) {
  const { locale, dictionary } = await pageContext(params);
  const { hero, limits, guard, scam, trust } = dictionary.safetyPage;
  const { common, home } = dictionary;
  const amounts = exampleAmounts(locale);

  return (
    <>
      <PageHero eyebrow={hero.eyebrow} title={hero.title} lede={hero.lede}>
        <PrincipleChain copy={dictionary.principle} />
      </PageHero>
      <ContentSection id="limits" eyebrow={limits.eyebrow} title={limits.title}>
        <IconCardGrid items={safeguardOrder.map((key) => ({ icon: safeguardIcons[key], ...limits.items[key] }))} />
      </ContentSection>
      <ContentSection id="guard" tone="muted" eyebrow={guard.eyebrow} title={guard.title} lede={guard.text}>
        <GuardDemo copy={guard} trace={dictionary.trace} spoken={home.hero.spokenAmount} amount={amounts.bill} />
      </ContentSection>
      <ContentSection id="scam" eyebrow={scam.eyebrow} title={scam.title} lede={scam.text}>
        <ScamCheck copy={scam} people={common.people} paidAmount={amounts.gasBill} />
      </ContentSection>
      <SecretsRule copy={scam} />
      <ContentSection id="trust" tone="muted" eyebrow={trust.eyebrow} title={trust.title}>
        <FeatureList items={trust.items} />
      </ContentSection>
      <RelatedPages locale={locale} dictionary={dictionary} current="safety" />
      <ClosingBand locale={locale} title={home.closing.title} nav={common.nav} />
    </>
  );
}
