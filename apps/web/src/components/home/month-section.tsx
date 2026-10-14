import { Container } from "@/components/layout/container";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Heading } from "@/components/shared/heading";
import { TextLink } from "@/components/shared/text-link";
import { momentImages } from "@/content/moment-images";
import type { Dictionary } from "@/i18n/dictionary";

import { MomentCard } from "./moment-card";

const HEADING_ID = "month-heading";

const order = ["bill", "caregiver", "refill", "letter", "call", "settled"] as const;

type MonthSectionProps = {
  copy: Dictionary["home"]["month"];
  /** Where "See how it works" leads. */
  href: string;
};

export function MonthSection({ copy, href }: MonthSectionProps) {
  return (
    <section aria-labelledby={HEADING_ID} className="py-16 sm:py-20 lg:py-28">
      <Container className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <Eyebrow>{copy.eyebrow}</Eyebrow>
          <Heading as="h2" size="title" id={HEADING_ID} className="mt-4">
            {copy.title}
          </Heading>
        </div>
        <TextLink href={href}>{copy.link}</TextLink>
      </Container>
      {/* The strip scrolls sideways inside itself, and is focusable so the
          arrow keys can scroll it. */}
      <div role="region" aria-label={copy.listLabel} tabIndex={0} className="mx-auto mt-8 max-w-7xl snap-x scroll-px-5 overflow-x-auto px-5 pb-4 sm:scroll-px-8 sm:px-8 lg:scroll-px-14 lg:px-14">
        <ul className="flex gap-4">
          {order.map((key) => (
            <MomentCard key={key} image={momentImages[key]} {...copy.moments[key]} />
          ))}
        </ul>
      </div>
    </section>
  );
}
