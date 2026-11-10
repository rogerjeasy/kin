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

/**
 * The opening of every page except the homepage: the same inset ink panel as
 * the homepage's, lit from within, with the tokens inside switched to the dark
 * theme so every card set in it keeps its contrast.
 */
export function PageHero({ eyebrow, title, lede, aside, children }: PageHeroProps) {
  const theme = { "data-theme": "dark" };

  return (
    <section {...theme} className="px-2 pt-2 sm:px-4 sm:pt-4">
      <div className="aurora relative overflow-clip rounded-[1.75rem] text-foreground shadow-xl sm:rounded-[2.5rem]">
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-[10%] bottom-0 h-px bg-linear-to-r from-transparent via-gold/60 to-transparent" />
        <Container
          className={cn(
            "grid items-center gap-10 py-14 sm:py-16 lg:gap-16 lg:py-24",
            aside && "lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]",
          )}
        >
          <div className="enter-stagger min-w-0">
            <Eyebrow>{eyebrow}</Eyebrow>
            <Heading as="h1" size="display" className="mt-5 max-w-4xl">
              {title}
            </Heading>
            <Lede className="mt-6 max-w-2xl">{lede}</Lede>
            {children ? <div className="mt-9">{children}</div> : null}
          </div>
          {aside ? <div className="enter min-w-0 [--enter-index:3]">{aside}</div> : null}
        </Container>
      </div>
    </section>
  );
}
