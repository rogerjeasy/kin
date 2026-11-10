import { InsetSection } from "@/components/layout/inset-section";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Heading } from "@/components/shared/heading";
import type { SpokenLine } from "@/components/shared/spoken-lines";
import type { Dictionary } from "@/i18n/dictionary";

import { ExchangeCard } from "./exchange-card";

const HEADING_ID = "voice-heading";

type VoiceSectionProps = {
  copy: Dictionary["home"]["voice"];
  people: Dictionary["common"]["people"];
};

export function VoiceSection({ copy, people }: VoiceSectionProps) {
  const rose = (text: string): SpokenLine => ({ speaker: people.rose, text, voice: "person" });
  const kin = (text: string, amount?: string): SpokenLine => ({ speaker: people.kin, text, voice: "kin", amount });

  const exchanges = [
    { label: copy.ask.label, lines: [rose(copy.ask.rose), kin(copy.ask.kin, copy.ask.kinAmount)] },
    { label: copy.decide.label, lines: [kin(copy.decide.kin, copy.decide.kinAmount), rose(copy.decide.rose)] },
    { label: copy.check.label, lines: [rose(copy.check.rose), kin(copy.check.kin)] },
  ];

  return (
    <InsetSection tone="ink" labelledBy={HEADING_ID}>
      <div className="grid items-end gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0">
          <Eyebrow>{copy.eyebrow}</Eyebrow>
          <Heading as="h2" size="title" id={HEADING_ID} className="mt-4 max-w-2xl">
            {copy.title}
          </Heading>
        </div>
        <p className="border-s border-gold/50 ps-5 text-lg text-muted-foreground">{copy.aside}</p>
      </div>
      <div className="relative mt-12 lg:mt-20">
        {/* One thread of light runs through the three calls. */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 hidden h-px bg-linear-to-r from-transparent via-gold/50 to-transparent lg:block" />
        <div className="relative grid gap-4 lg:grid-cols-3 lg:gap-6">
          {exchanges.map((exchange) => (
            <ExchangeCard key={exchange.label} label={exchange.label} lines={exchange.lines} />
          ))}
        </div>
      </div>
    </InsetSection>
  );
}
