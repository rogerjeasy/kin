import type { ReactNode } from "react";

import { Section } from "@/components/layout/section";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Heading } from "@/components/shared/heading";
import { Lede } from "@/components/shared/lede";

type ContentSectionProps = {
  /** Unique on the page. Ties the section to its heading. */
  id: string;
  eyebrow: string;
  title: string;
  lede?: string;
  tone?: "plain" | "muted";
  children: ReactNode;
};

/** A titled section of an inner page. */
export function ContentSection({ id, eyebrow, title, lede, tone, children }: ContentSectionProps) {
  const headingId = `${id}-heading`;

  return (
    <Section tone={tone} labelledBy={headingId}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <Heading as="h2" size="title" id={headingId} className="mt-4 max-w-3xl">
        {title}
      </Heading>
      {lede ? <Lede className="mt-5 max-w-2xl">{lede}</Lede> : null}
      <div className="mt-10">{children}</div>
    </Section>
  );
}
