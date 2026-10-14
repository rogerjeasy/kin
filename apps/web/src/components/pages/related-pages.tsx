import { Section } from "@/components/layout/section";
import { Heading } from "@/components/shared/heading";
import { mainNav, routes, type MainNavKey } from "@/content/site-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";

import { RelatedCard } from "./related-card";

const HEADING_ID = "related-heading";

type RelatedPagesProps = {
  locale: Locale;
  dictionary: Dictionary;
  /** The page being read, which is left out. */
  current: MainNavKey;
};

/** The homepage already introduces each page in a few words. This reuses them. */
function introductions({ home }: Dictionary): Record<MainNavKey, { eyebrow: string; title: string; link: string }> {
  return {
    howItWorks: home.month,
    safety: home.safety,
    caregivers: home.audience.caregivers,
    pricing: home.audience.pricing,
  };
}

/** The way onward from an inner page: the three pages the reader is not on. */
export function RelatedPages({ locale, dictionary, current }: RelatedPagesProps) {
  const pages = introductions(dictionary);

  return (
    <Section labelledBy={HEADING_ID} className="border-t lg:py-20">
      <Heading as="h2" size="subtitle" id={HEADING_ID}>
        {dictionary.common.related.title}
      </Heading>
      <ul className="mt-8 grid gap-4 md:grid-cols-3 lg:gap-6">
        {mainNav
          .filter((key) => key !== current)
          .map((key) => (
            <RelatedCard
              key={key}
              href={localizedPath(locale, routes[key])}
              eyebrow={pages[key].eyebrow}
              title={pages[key].title}
              link={pages[key].link}
            />
          ))}
      </ul>
    </Section>
  );
}
