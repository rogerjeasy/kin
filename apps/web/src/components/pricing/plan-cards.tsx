import { ButtonLink } from "@/components/shared/button-link";
import { TextLink } from "@/components/shared/text-link";
import { routes } from "@/content/site-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";

import { PlanCard } from "./plan-card";

type PlanCardsProps = {
  locale: Locale;
  copy: Dictionary["pricingPage"]["plans"];
  /** The label of the button that starts a circle. */
  startLabel: string;
  /** The label of the link to the caregivers' page. */
  caregiversLabel: string;
};

/** The three plans a person can choose for themselves, the family's in the middle. */
export function PlanCards({ locale, copy, startLabel, caregiversLabel }: PlanCardsProps) {
  const { free, family, professional } = copy.cards;

  return (
    <ul aria-label={copy.label} className="grid gap-4 lg:grid-cols-3 lg:gap-6">
      <PlanCard plan={free} includes={copy.includes}>
        <TextLink href={localizedPath(locale, routes.caregivers)}>{caregiversLabel}</TextLink>
      </PlanCard>
      <PlanCard plan={family} includes={copy.includes} badge={family.badge} tone="band">
        <ButtonLink href={localizedPath(locale, routes.start)} variant="inverse" className="w-full whitespace-normal">
          {startLabel}
        </ButtonLink>
      </PlanCard>
      <PlanCard plan={professional} includes={copy.includes} />
    </ul>
  );
}
