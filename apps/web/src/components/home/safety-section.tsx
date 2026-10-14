import { Section } from "@/components/layout/section";
import { Eyebrow } from "@/components/shared/eyebrow";
import { FeatureList } from "@/components/shared/feature-list";
import { Heading } from "@/components/shared/heading";
import { Lede } from "@/components/shared/lede";
import { RecordTrace } from "@/components/shared/record-trace";
import { TextLink } from "@/components/shared/text-link";
import type { Dictionary } from "@/i18n/dictionary";

const HEADING_ID = "safety-heading";

type SafetySectionProps = {
  copy: Dictionary["home"]["safety"];
  trace: Dictionary["trace"];
  spoken: string;
  amount: string;
  href: string;
};

export function SafetySection({ copy, trace, spoken, amount, href }: SafetySectionProps) {
  return (
    <Section tone="muted" labelledBy={HEADING_ID}>
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
        <div className="min-w-0 lg:col-span-5">
          <Eyebrow>{copy.eyebrow}</Eyebrow>
          <Heading as="h2" size="title" id={HEADING_ID} className="mt-4">
            {copy.title}
          </Heading>
          <Lede className="mt-5">{copy.lede}</Lede>
          <TextLink href={href} className="mt-5">
            {copy.link}
          </TextLink>
        </div>
        <div className="min-w-0 lg:col-span-7">
          <FeatureList items={copy.safeguards} />
        </div>
      </div>
      <div className="mt-10 lg:mt-14">
        <RecordTrace copy={trace} spoken={spoken} amount={amount} />
      </div>
    </Section>
  );
}
