import { InsetSection } from "@/components/layout/inset-section";
import { routes, type RouteKey } from "@/content/site-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";

import { ButtonLink } from "./button-link";
import { DemoButton } from "./demo-button";
import { GlowKnot } from "./glow-knot";
import { Heading } from "./heading";
import { TextLink } from "./text-link";

const HEADING_ID = "closing-heading";

type ClosingBandProps = {
  locale: Locale;
  title: string;
  nav: Dictionary["common"]["nav"];
  /** The page the band is on, so it does not link to itself. */
  current?: RouteKey;
};

/** The last thing on every page: one more invitation to try the demo or start, lit by the knot. */
export function ClosingBand({ locale, title, nav, current }: ClosingBandProps) {
  return (
    <InsetSection tone="ink" labelledBy={HEADING_ID} className="pb-2 sm:pb-4" containerClassName="py-16 sm:py-20 lg:py-24">
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-[10%] top-0 h-px bg-linear-to-r from-transparent via-gold/70 to-transparent" />
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
        <div className="enter-stagger min-w-0">
          <GlowKnot className="mb-8 w-24 lg:hidden" />
          <Heading as="h2" size="display" id={HEADING_ID} className="max-w-3xl">
            {title}
          </Heading>
          <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-3">
            <DemoButton locale={locale} label={nav.demo} variant="inverse" />
            <ButtonLink href={localizedPath(locale, routes.start)} variant="outline" className="border-band-border bg-foreground/5 hover:bg-foreground/10">
              {nav.startLong}
            </ButtonLink>
            {current === "howItWorks" ? null : (
              <TextLink href={localizedPath(locale, routes.howItWorks)}>{nav.seeMonth}</TextLink>
            )}
          </div>
        </div>
        <GlowKnot className="hidden w-72 lg:grid xl:w-80" />
      </div>
    </InsetSection>
  );
}
