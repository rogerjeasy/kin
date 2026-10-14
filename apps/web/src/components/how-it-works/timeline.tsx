import { Container } from "@/components/layout/container";
import { ShareLegend } from "@/components/shared/share-legend";
import { momentImages } from "@/content/moment-images";
import { monthScenes } from "@/content/month-scenes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";

import { TimelineEntry } from "./timeline-entry";
import { TimelineFacts } from "./timeline-facts";
import { TimelineQuote } from "./timeline-quote";

type TimelineProps = {
  locale: Locale;
  copy: Dictionary["howItWorks"]["timeline"];
  people: Dictionary["common"]["people"];
  /** The photographs' descriptions, shared with the homepage. */
  moments: Dictionary["home"]["month"]["moments"];
};

/** The month, day by day: what happened, what was said, who approved it. */
export function Timeline({ locale, copy, people, moments }: TimelineProps) {
  return (
    <section aria-label={copy.label} className="py-14 sm:py-16 lg:py-24">
      <Container>
        <ol>
          {copy.entries.map((entry, index) => {
            const scene = monthScenes[index] ?? {};
            const photo = scene.moment
              ? { src: momentImages[scene.moment], alt: moments[scene.moment].alt }
              : undefined;

            return (
              <TimelineEntry
                key={entry.day}
                day={entry.day}
                title={entry.title}
                text={entry.text}
                photo={photo}
                isLast={index === copy.entries.length - 1}
              >
                {scene.showsShares ? (
                  <div className="mt-5">
                    <ShareLegend locale={locale} people={people} align="start" />
                  </div>
                ) : null}
                {scene.speaker ? <TimelineQuote voice={scene.speaker} speaker={entry.speaker} quote={entry.quote} /> : null}
                <TimelineFacts
                  facts={[
                    { label: copy.approvalLabel, value: entry.approval },
                    { label: copy.paypalLabel, value: entry.paypal },
                  ]}
                />
              </TimelineEntry>
            );
          })}
        </ol>
      </Container>
    </section>
  );
}
