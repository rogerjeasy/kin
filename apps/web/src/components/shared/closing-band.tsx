import { Section } from "@/components/layout/section";
import { routes, type RouteKey } from "@/content/site-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";

import { ButtonLink } from "./button-link";
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

/** The last thing on every page: one more invitation to start. */
export function ClosingBand({ locale, title, nav, current }: ClosingBandProps) {
  return (
    <Section tone="band" labelledBy={HEADING_ID} className="lg:py-24">
      <div className="flex flex-wrap items-center justify-between gap-x-12 gap-y-7">
        <Heading as="h2" size="title" id={HEADING_ID} className="max-w-xl">
          {title}
        </Heading>
        <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
          <ButtonLink href={localizedPath(locale, routes.start)} variant="inverse">
            {nav.startLong}
          </ButtonLink>
          {current === "howItWorks" ? null : (
            <TextLink href={localizedPath(locale, routes.howItWorks)}>{nav.seeMonth}</TextLink>
          )}
        </div>
      </div>
    </Section>
  );
}
