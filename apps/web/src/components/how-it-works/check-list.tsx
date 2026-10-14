import { CheckIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const kinds = {
  does: { mark: CheckIcon, card: "border bg-card", markTone: "text-highlight" },
  doesNot: { mark: XIcon, card: "bg-band text-band-foreground", markTone: "text-band-highlight" },
} as const;

type CheckListProps = {
  title: string;
  items: readonly string[];
  kind: keyof typeof kinds;
};

/** A titled list of things the AI does, or does not do. */
export function CheckList({ title, items, kind }: CheckListProps) {
  const { mark: Mark, card, markTone } = kinds[kind];

  return (
    <div className={cn("min-w-0 rounded-3xl p-6 sm:p-9", card)}>
      <h3 className="font-serif text-subtitle text-balance">{title}</h3>
      <ul className="mt-6 space-y-3.5">
        {items.map((item) => (
          <li key={item} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3">
            <Mark aria-hidden="true" className={cn("mt-1 size-5", markTone)} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
