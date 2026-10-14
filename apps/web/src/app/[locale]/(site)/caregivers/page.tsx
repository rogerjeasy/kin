import { BadgeCheckIcon, BanknoteIcon, EyeOffIcon, FileTextIcon, LanguagesIcon, MicIcon, ReceiptIcon } from "lucide-react";
import type { Metadata } from "next";

import { BillingWeek } from "@/components/caregivers/billing-week";
import { CaregiverPhoto } from "@/components/caregivers/caregiver-photo";
import { IncomeRecord } from "@/components/caregivers/income-record";
import { Section } from "@/components/layout/section";
import { ContentSection } from "@/components/pages/content-section";
import { IconCardGrid } from "@/components/pages/icon-card-grid";
import { PageHero } from "@/components/pages/page-hero";
import { RelatedPages } from "@/components/pages/related-pages";
import { ClosingBand } from "@/components/shared/closing-band";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Heading } from "@/components/shared/heading";
import { Lede } from "@/components/shared/lede";
import { exampleAmounts } from "@/content/example-amounts";
import { pageContext, pageMetadata } from "@/i18n/page-context";
import { fill } from "@/i18n/template";

const RECORD_HEADING_ID = "record-heading";

export function generateMetadata({ params }: PageProps<"/[locale]/caregivers">): Promise<Metadata> {
  return pageMetadata(params, "caregivers");
}

export default async function CaregiversPage({ params }: PageProps<"/[locale]/caregivers">) {
  const { locale, dictionary } = await pageContext(params);
  const { hero, features, exchange, record, privacy, language, free } = dictionary.caregiversPage;
  const { common, home } = dictionary;
  const { caregiverPay } = exampleAmounts(locale);

  return (
    <>
      <PageHero
        eyebrow={hero.eyebrow}
        title={hero.title}
        lede={hero.lede}
        aside={
          <CaregiverPhoto
            alt={hero.imageAlt}
            payment={{
              text: fill(home.circle.ticker, { amount: caregiverPay }),
              note: home.circle.tickerNote,
              tag: common.example.sandbox,
            }}
          />
        }
      />
      <ContentSection id="features" eyebrow={features.eyebrow} title={features.title}>
        <IconCardGrid
          columns="two"
          items={[
            { icon: MicIcon, ...features.items.voice },
            { icon: BanknoteIcon, ...features.items.sameDay },
            { icon: FileTextIcon, ...features.items.record },
            { icon: ReceiptIcon, ...features.items.expenses },
          ]}
        />
      </ContentSection>
      <ContentSection id="exchange" tone="muted" eyebrow={exchange.eyebrow} title={exchange.title}>
        <BillingWeek copy={exchange} people={common.people} />
      </ContentSection>
      <Section labelledBy={RECORD_HEADING_ID}>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="min-w-0">
            <Eyebrow>{record.eyebrow}</Eyebrow>
            <Heading as="h2" size="title" id={RECORD_HEADING_ID} className="mt-4">
              {record.title}
            </Heading>
            <Lede className="mt-5">{record.text}</Lede>
          </div>
          <div className="min-w-0">
            <IncomeRecord copy={record} amount={caregiverPay} tag={common.example.sandbox} />
          </div>
        </div>
      </Section>
      <Section tone="muted">
        <IconCardGrid
          as="h2"
          items={[
            { icon: EyeOffIcon, ...privacy },
            { icon: LanguagesIcon, ...language },
            { icon: BadgeCheckIcon, ...free },
          ]}
        />
      </Section>
      <RelatedPages locale={locale} dictionary={dictionary} current="caregivers" />
      <ClosingBand locale={locale} title={home.closing.title} nav={common.nav} />
    </>
  );
}
