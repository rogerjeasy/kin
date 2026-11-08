import { BotMessageSquareIcon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";
import type { Dictionary } from "@/i18n/dictionary";

import { AskKinSuggestions } from "./ask-kin-suggestions";

type Props = { copy: Dictionary["askKin"]; suggestions: readonly string[]; href: string };

/** The overview's way into Ask Kin: what it does, and questions that open it filled in. */
export function AskKinCard({ copy, suggestions, href }: Props) {
  return (
    <Panel title={copy.card.title} description={copy.card.text} link={{ href, label: copy.card.open }} aside={<BotMessageSquareIcon aria-hidden="true" className="size-6 shrink-0 text-highlight" />}>
      <AskKinSuggestions label={copy.suggestions.label} questions={suggestions} href={(question) => `${href}?${new URLSearchParams({ q: question }).toString()}`} />
    </Panel>
  );
}
