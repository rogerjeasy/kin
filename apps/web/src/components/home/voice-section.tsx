import { Section } from "@/components/layout/section";
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
    <Section tone="band" labelledBy={HEADING_ID}>
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
        <div className="min-w-0">
          <Eyebrow className="text-band-muted">{copy.eyebrow}</Eyebrow>
          <Heading as="h2" size="title" id={HEADING_ID} className="mt-4 max-w-2xl">
            {copy.title}
          </Heading>
        </div>
        <p className="max-w-sm text-lg text-band-muted">{copy.aside}</p>
      </div>
      <div className="mt-10 grid lg:mt-14 lg:grid-cols-3 lg:border-t lg:border-band-border lg:pt-8">
        {exchanges.map((exchange) => (
          <ExchangeCard key={exchange.label} label={exchange.label} lines={exchange.lines} />
        ))}
      </div>
    </Section>
  );
}
