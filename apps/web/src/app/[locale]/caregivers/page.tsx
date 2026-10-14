import type { Metadata } from "next";

import caregiverVisit from "@/assets/images/caregiver-visit.jpg";
import { Container } from "@/components/layout/container";
import { ContentSection } from "@/components/pages/content-section";
import { NoteCard } from "@/components/pages/note-card";
import { PageHero } from "@/components/pages/page-hero";
import { ClosingBand } from "@/components/shared/closing-band";
import { FeatureList } from "@/components/shared/feature-list";
import { SpokenLines } from "@/components/shared/spoken-lines";
import { pageContext, pageMetadata } from "@/i18n/page-context";

export function generateMetadata({ params }: PageProps<"/[locale]/caregivers">): Promise<Metadata> {
  return pageMetadata(params, "caregivers");
}

export default async function CaregiversPage({ params }: PageProps<"/[locale]/caregivers">) {
  const { locale, dictionary } = await pageContext(params);
  const { hero, features, exchange, privacy, free } = dictionary.caregiversPage;
  const { people } = dictionary.common;

  return (
    <>
      <PageHero
        eyebrow={hero.eyebrow}
        title={hero.title}
        lede={hero.lede}
        image={{ src: caregiverVisit, alt: hero.imageAlt }}
      />
      <ContentSection id="features" eyebrow={features.eyebrow} title={features.title}>
        <FeatureList items={features.items} />
      </ContentSection>
      <ContentSection id="exchange" tone="muted" eyebrow={exchange.eyebrow} title={exchange.title}>
        <div className="max-w-3xl rounded-3xl border bg-card p-6 sm:p-9">
          <SpokenLines
            lines={[
              { speaker: people.amara, text: exchange.amaraLine, voice: "person" },
              { speaker: people.kin, text: exchange.kinLine, voice: "kin", amount: exchange.kinAmount },
            ]}
          />
        </div>
        <p className="mt-8 max-w-2xl text-lg text-muted-foreground">{exchange.note}</p>
      </ContentSection>
      <div className="py-16 sm:py-20 lg:py-28">
        <Container className="grid gap-6 md:grid-cols-2 lg:gap-8">
          <NoteCard title={privacy.title} text={privacy.text} />
          <NoteCard title={free.title} text={free.text} />
        </Container>
      </div>
      <ClosingBand locale={locale} title={dictionary.home.closing.title} nav={dictionary.common.nav} />
    </>
  );
}
