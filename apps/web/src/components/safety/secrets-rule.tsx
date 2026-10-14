import { XIcon } from "lucide-react";

import { Section } from "@/components/layout/section";
import { Heading } from "@/components/shared/heading";
import type { Dictionary } from "@/i18n/dictionary";

const HEADING_ID = "rule-heading";

type SecretsRuleProps = { copy: Dictionary["safetyPage"]["scam"] };

/** The one rule a family teaches its parent, given a band to itself. */
export function SecretsRule({ copy }: SecretsRuleProps) {
  return (
    <Section tone="band" labelledBy={HEADING_ID} className="lg:py-24">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="min-w-0">
          <Heading as="h2" size="title" id={HEADING_ID}>
            {copy.ruleTitle}
          </Heading>
          <p className="mt-5 max-w-xl text-lg text-band-muted">{copy.rule}</p>
        </div>
        <div className="min-w-0">
          <p className="font-mono text-xs font-medium text-band-highlight uppercase ltr:tracking-widest">{copy.neverLabel}</p>
          <ul className="mt-3 border-t border-band-border">
            {copy.never.map((secret) => (
              <li key={secret} className="flex items-center gap-4 border-b border-band-border py-4 font-serif text-2xl">
                <XIcon aria-hidden="true" className="size-5 shrink-0 text-band-highlight" />
                {secret}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
