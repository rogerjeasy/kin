import caregiverVisit from "@/assets/images/caregiver-visit.jpg";
import { Container } from "@/components/layout/container";
import { routes } from "@/content/site-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";

import { AudienceCard } from "./audience-card";
import { PriceRows } from "./price-rows";

type AudienceSectionProps = { locale: Locale; copy: Dictionary["home"]["audience"] };

export function AudienceSection({ locale, copy }: AudienceSectionProps) {
  const { caregivers, pricing } = copy;

  return (
    <div className="py-16 sm:py-20 lg:py-28">
      <Container className="reveal grid gap-4 md:grid-cols-2 lg:gap-6">
        <AudienceCard
          eyebrow={caregivers.eyebrow}
          title={caregivers.title}
          text={caregivers.text}
          link={{ href: localizedPath(locale, routes.caregivers), label: caregivers.link }}
          image={{ src: caregiverVisit, alt: caregivers.imageAlt }}
        />
        <AudienceCard
          eyebrow={pricing.eyebrow}
          title={pricing.title}
          text={pricing.text}
          link={{ href: localizedPath(locale, routes.pricing), label: pricing.link }}
        >
          <PriceRows rows={pricing.rows} />
        </AudienceCard>
      </Container>
    </div>
  );
}
