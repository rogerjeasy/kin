import { Container } from "@/components/layout/container";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Heading } from "@/components/shared/heading";
import { TextLink } from "@/components/shared/text-link";
import { momentImages } from "@/content/moment-images";
import type { Dictionary } from "@/i18n/dictionary";

import { MomentCard } from "./moment-card";

const HEADING_ID = "month-heading";

const order = ["bill", "caregiver", "refill", "letter", "call", "settled"] as const;

/** The first and last moments take two columns, so the grid reads as a month that opens and closes. */
const wide = new Set<(typeof order)[number]>(["bill", "settled"]);

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
      {/* Below lg the moments are a strip that scrolls sideways inside itself,
          focusable so the arrow keys can scroll it. From lg they settle into a
          grid and nothing needs to scroll. */}
      <div role="region" aria-label={copy.listLabel} tabIndex={0} className="mx-auto mt-10 max-w-7xl snap-x scroll-px-5 overflow-x-auto px-5 pt-2 pb-6 sm:scroll-px-8 sm:px-8 lg:scroll-px-14 lg:px-14">
        <ul className="reveal flex gap-4 lg:grid lg:grid-cols-4 lg:gap-5">
          {order.map((key) => (
            <MomentCard key={key} image={momentImages[key]} wide={wide.has(key)} {...copy.moments[key]} />
          ))}
        </ul>
      </div>
    </section>
  );
}
