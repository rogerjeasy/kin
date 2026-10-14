import type { ReactNode } from "react";

import { Container } from "@/components/layout/container";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Heading } from "@/components/shared/heading";
import { Lede } from "@/components/shared/lede";
import { cn } from "@/lib/utils";

type PageHeroProps = {
  eyebrow: string;
  title: string;
  lede: string;
  /** What stands beside the words on a wide screen, and below them on a phone. */
  aside?: ReactNode;
  /** What follows the lede: a status, a few figures, the way onward. */
  children?: ReactNode;
};

/** The opening of every page except the homepage. */
export function PageHero({ eyebrow, title, lede, aside, children }: PageHeroProps) {
  return (
    <section className="border-b py-12 sm:py-16 lg:py-24">
      <Container className={cn("grid items-center gap-10 lg:gap-16", aside && "lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]")}>
        <div className="min-w-0">
          <Eyebrow>{eyebrow}</Eyebrow>
          <Heading as="h1" size="display" className="mt-5 max-w-4xl">
            {title}
          </Heading>
          <Lede className="mt-6 max-w-2xl">{lede}</Lede>
          {children ? <div className="mt-8">{children}</div> : null}
        </div>
        {aside ? <div className="min-w-0">{aside}</div> : null}
      </Container>
    </section>
  );
}
