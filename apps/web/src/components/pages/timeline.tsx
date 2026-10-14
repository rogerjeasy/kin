import { Container } from "@/components/layout/container";
import type { Dictionary } from "@/i18n/dictionary";

import { TimelineEntry } from "./timeline-entry";

type TimelineProps = { copy: Dictionary["howItWorks"]["timeline"] };

export function Timeline({ copy }: TimelineProps) {
  return (
    <section aria-label={copy.label} className="py-8 sm:py-12">
      <Container>
        <ol>
          {copy.entries.map((entry) => (
            <TimelineEntry key={entry.day} {...entry} />
          ))}
        </ol>
      </Container>
    </section>
  );
}
