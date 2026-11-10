import type { ReactNode } from "react";

import { InsetSection } from "@/components/layout/inset-section";
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

/** A titled section of an inner page. A muted one is set into the page as a lit panel. */
export function ContentSection({ id, eyebrow, title, lede, tone = "plain", children }: ContentSectionProps) {
  const headingId = `${id}-heading`;
  const body = (
    <>
      <Eyebrow>{eyebrow}</Eyebrow>
      <Heading as="h2" size="title" id={headingId} className="mt-4 max-w-3xl">
        {title}
      </Heading>
      {lede ? <Lede className="mt-5 max-w-2xl">{lede}</Lede> : null}
      <div className="reveal mt-10 lg:mt-12">{children}</div>
    </>
  );

  return tone === "muted" ? (
    <InsetSection tone="muted" labelledBy={headingId}>
      {body}
    </InsetSection>
  ) : (
    <Section labelledBy={headingId}>{body}</Section>
  );
}
