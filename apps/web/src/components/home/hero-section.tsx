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

import { CirclePeople } from "./circle-people";
import { PortraitCard } from "./portrait-card";

type HeroSectionProps = {
  locale: Locale;
  copy: Dictionary["home"]["hero"];
  nav: Dictionary["common"]["nav"];
  limit: string;
};

export function HeroSection({ locale, copy, nav, limit }: HeroSectionProps) {
  return (
    <section className="py-10 sm:py-14 lg:py-20">
      <Container className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="min-w-0">
          <Eyebrow>{copy.eyebrow}</Eyebrow>
          <Heading as="h1" size="display" className="mt-5">
            {copy.titleLead} <Emphasis>{copy.titleEmphasis}</Emphasis>
          </Heading>
          <Lede className="mt-6">{copy.lede}</Lede>
          <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-3">
            <ButtonLink href={localizedPath(locale, routes.start)}>{nav.startLong}</ButtonLink>
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              <DemoButton locale={locale} label={nav.demo} />
              <span className="text-sm text-muted-foreground">{nav.demoNote}</span>
            </span>
            <TextLink href={localizedPath(locale, routes.howItWorks)}>{nav.seeMonth}</TextLink>
          </div>
          <div className="mt-9">
            <CirclePeople names={copy.circleNames} note={copy.circleNote} />
          </div>
        </div>
        <div className="min-w-0">
          <PortraitCard locale={locale} copy={copy} limit={limit} />
        </div>
      </Container>
    </section>
  );
}
