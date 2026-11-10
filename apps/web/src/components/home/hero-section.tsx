import roseFace from "@/assets/images/rose-face.jpg";
import { Container } from "@/components/layout/container";
import { ButtonLink } from "@/components/shared/button-link";
import { DemoButton } from "@/components/shared/demo-button";
import { Emphasis } from "@/components/shared/emphasis";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Heading } from "@/components/shared/heading";
import { Lede } from "@/components/shared/lede";
import { TextLink } from "@/components/shared/text-link";
import { routes } from "@/content/site-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";

import { CirclePeople } from "./circle-people";
import { HeroVisual } from "./hero-scene/hero-visual";
import { SpokenCaption } from "./spoken-caption";

type HeroSectionProps = {
  locale: Locale;
  copy: Dictionary["home"]["hero"];
  nav: Dictionary["common"]["nav"];
  limit: string;
};

/**
 * The opening: an ink panel lit from within. The words on one side; on the
 * other the Kin knot turning as light around Rose, with what Kin said to her
 * this morning floating over it.
 */
export function HeroSection({ locale, copy, nav, limit }: HeroSectionProps) {
  const theme = { "data-theme": "dark" };

  return (
    <section {...theme} className="px-2 pt-2 sm:px-4 sm:pt-4">
      <div className="aurora relative overflow-clip rounded-[1.75rem] text-foreground shadow-xl sm:rounded-[2.5rem]">
        <Container className="grid items-center gap-6 py-12 sm:py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:py-20">
          <div className="enter-stagger min-w-0">
            <Eyebrow>{copy.eyebrow}</Eyebrow>
            <Heading as="h1" size="display" className="mt-6">
              {copy.titleLead}{" "}
              <span className="text-luminous">
                <Emphasis>{copy.titleEmphasis}</Emphasis>
              </span>
            </Heading>
            <Lede className="mt-6">{copy.lede}</Lede>
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
              <ButtonLink href={localizedPath(locale, routes.start)} variant="inverse">
                {nav.startLong}
              </ButtonLink>
              <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                <DemoButton locale={locale} label={nav.demo} className="border-band-border bg-foreground/5 hover:bg-foreground/10" />
                <span className="text-sm text-muted-foreground">{nav.demoNote}</span>
              </span>
            </div>
            <TextLink href={localizedPath(locale, routes.howItWorks)} className="mt-2">
              {nav.seeMonth}
            </TextLink>
            <div className="mt-7">
              <CirclePeople names={copy.circleNames} note={copy.circleNote} />
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-1">
            <HeroVisual portrait={roseFace} className="col-start-1 row-start-1 enter" />
            <p className="relative z-10 col-start-1 row-start-1 hidden max-w-[15rem] self-start justify-self-end rounded-2xl border border-band-border bg-band px-4 py-3 text-sm shadow-lg sm:block motion-safe:animate-float">
              <strong className="block font-semibold">{copy.pinTitle}</strong>
              <span className="text-muted-foreground">{fill(copy.pinNote, { limit })}</span>
            </p>
            <SpokenCaption
              locale={locale}
              copy={copy}
              className="relative z-10 col-start-1 row-start-2 mt-2 max-w-md border border-band-border shadow-xl sm:row-start-1 sm:mt-0 sm:self-end sm:justify-self-start"
            />
          </div>
        </Container>
      </div>
    </section>
  );
}
