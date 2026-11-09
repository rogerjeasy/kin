import { HandHeartIcon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";
import type { AskView } from "@/server/quiet-shares";

import type { QuietCopy } from "./quiet-screen";

type Props = { copy: QuietCopy["card"]; ask: AskView | null; href: string; format: Formatters };

/** The overview's way into quiet shares: the cost the family is covering now, and how far it has come. */
export function QuietShareCard({ copy, ask, href, format }: Props) {
  const slots = ask === null ? null : { title: ask.title, cost: format.money(ask.costCents) };
  const line =
    ask === null || slots === null
      ? null
      : ask.state === "gathering"
        ? fill(copy.gathering, { ...slots, answered: format.count(ask.answeredCount), asked: format.count(ask.askedCount) })
        : ask.state === "short"
          ? fill(copy.short, { ...slots, shortfall: format.money(ask.shortfallCents ?? 0) })
          : ask.state === "planned"
            ? fill(copy.planned, { ...slots, accepted: format.count(ask.acceptedCount), parts: format.count(ask.partCount) })
            : fill(copy.agreed, slots);
  return (
    <Panel title={copy.title} description={copy.text} link={{ href, label: copy.open }} aside={<HandHeartIcon aria-hidden="true" className="size-6 shrink-0 text-highlight" />}>
      {line === null ? <p className="sr-only">{copy.title}</p> : <p dir="auto" className="text-base font-medium text-pretty">{line}</p>}
    </Panel>
  );
}
