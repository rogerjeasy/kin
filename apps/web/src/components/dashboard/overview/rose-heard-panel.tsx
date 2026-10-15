import { Volume2Icon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";
import { RichText } from "@/components/shared/rich-text";
import { SpokenAmount } from "@/components/shared/spoken-amount";

export type HeardLine = { key: string; day: string; text: string; amount: string };

type RoseHeardPanelProps = { title: string; description: string; lines: readonly HeardLine[]; className?: string };

/** The sentences Kin spoke to Rose, with each amount as she heard it. */
export function RoseHeardPanel({ title, description, lines, className }: RoseHeardPanelProps) {
  return (
    <Panel title={title} description={description} className={className}>
      <ol className="space-y-5">
        {lines.map((line) => (
          <li key={line.key} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
            <span aria-hidden="true" className="mt-0.5 inline-flex size-7 items-center justify-center rounded-full bg-secondary text-highlight">
              <Volume2Icon className="size-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">{line.day}</p>
              <p className="mt-1 font-serif text-lg leading-snug text-pretty">
                <RichText template={line.text} slots={{ amount: <SpokenAmount>{line.amount}</SpokenAmount> }} />
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
