import { XIcon } from "lucide-react";

import { InsetSection } from "@/components/layout/inset-section";
import { Heading } from "@/components/shared/heading";
import type { Dictionary } from "@/i18n/dictionary";

const HEADING_ID = "rule-heading";

type SecretsRuleProps = { copy: Dictionary["safetyPage"]["scam"] };

/** The one rule a family teaches its parent, given an ink panel to itself. */
export function SecretsRule({ copy }: SecretsRuleProps) {
  return (
    <InsetSection tone="ink" labelledBy={HEADING_ID}>
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="min-w-0">
          <Heading as="h2" size="title" id={HEADING_ID}>
            {copy.ruleTitle}
          </Heading>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">{copy.rule}</p>
        </div>
        <div className="min-w-0 rounded-3xl border border-foreground/10 bg-foreground/[0.04] p-6 backdrop-blur-md sm:p-8">
          <p className="font-mono text-xs font-medium text-highlight uppercase ltr:tracking-widest">{copy.neverLabel}</p>
          <ul className="enter-stagger mt-4 space-y-2">
            {copy.never.map((secret) => (
              <li key={secret} className="flex items-center gap-4 rounded-2xl border border-foreground/10 bg-card/60 px-4 py-3.5 font-serif text-2xl">
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-danger/15 text-danger">
                  <XIcon className="size-4" />
                </span>
                <span className="min-w-0">{secret}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </InsetSection>
  );
}
