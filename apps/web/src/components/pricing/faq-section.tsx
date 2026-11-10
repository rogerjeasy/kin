import { Section } from "@/components/layout/section";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Heading } from "@/components/shared/heading";
import type { Dictionary } from "@/i18n/dictionary";

import { FaqList } from "./faq-list";

const HEADING_ID = "faq-heading";

type FaqSectionProps = { copy: Dictionary["pricingPage"]["faq"] };

/** The questions, with their heading beside them on a wide screen. */
export function FaqSection({ copy }: FaqSectionProps) {
  return (
    <Section labelledBy={HEADING_ID}>
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
        <div className="min-w-0 lg:sticky lg:top-[calc(var(--header-height)+2rem)] lg:col-span-5 lg:self-start">
          <Eyebrow>{copy.eyebrow}</Eyebrow>
          <Heading as="h2" size="title" id={HEADING_ID} className="mt-4">
            {copy.title}
          </Heading>
        </div>
        <div className="min-w-0 lg:col-span-7">
          <FaqList items={copy.items} />
        </div>
      </div>
    </Section>
  );
}
