import { InsetSection } from "@/components/layout/inset-section";
import { Emphasis } from "@/components/shared/emphasis";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Heading } from "@/components/shared/heading";
import { Lede } from "@/components/shared/lede";
import { PaymentTicker } from "@/components/shared/payment-ticker";
import { ShareLegend } from "@/components/shared/share-legend";
import { exampleShares } from "@/content/example-family";
import { StepList } from "@/components/shared/step-list";
import type { ExampleAmounts } from "@/content/example-amounts";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";

import { SettlementCard } from "./settlement-card";
import { ShareRing } from "./share-ring";

const HEADING_ID = "circle-heading";

type CircleSectionProps = {
  locale: Locale;
  copy: Dictionary["home"]["circle"];
  common: Dictionary["common"];
  amounts: ExampleAmounts;
};

export function CircleSection({ locale, copy, common, amounts }: CircleSectionProps) {
  const { people, example } = common;

  return (
    <InsetSection tone="muted" labelledBy={HEADING_ID}>
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        {/* The words come first on a phone, the picture first on a wide screen. */}
        <figure className="order-2 min-w-0 lg:order-1">
          <div className="reveal relative">
            <div aria-hidden="true" className="pointer-events-none absolute inset-[12%] rounded-full bg-gold/20 blur-3xl" />
            <ShareRing label={copy.ringAlt} />
          </div>
          <figcaption className="mt-4 text-center">
            <p className="font-serif text-3xl">{people.rose}</p>
            <p className="mt-1 text-sm text-muted-foreground">{fill(copy.roseNote, { limit: amounts.limit })}</p>
            <div className="mt-5">
              <ShareLegend locale={locale} shares={exampleShares(people)} />
            </div>
          </figcaption>
          <div className="mt-7">
            <PaymentTicker
              text={fill(copy.ticker, { amount: amounts.caregiverPay })}
              note={copy.tickerNote}
              tag={example.sandbox}
              className="mx-auto max-w-lg motion-safe:animate-float"
            />
          </div>
        </figure>
        <div className="order-1 min-w-0 lg:order-2">
          <Eyebrow>{copy.eyebrow}</Eyebrow>
          <Heading as="h2" size="title" id={HEADING_ID} className="mt-4">
            {copy.titleLead} <Emphasis>{copy.titleEmphasis}</Emphasis>
          </Heading>
          <Lede className="mt-5">{copy.lede}</Lede>
          <div className="mt-10">
            <StepList
              steps={copy.steps}
              afterLast={
                <SettlementCard
                  text={fill(copy.settlement, { elena: amounts.elena, ana: amounts.ana })}
                  status={example.waiting}
                />
              }
            />
          </div>
        </div>
      </div>
    </InsetSection>
  );
}
