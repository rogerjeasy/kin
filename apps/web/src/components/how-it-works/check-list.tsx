import { CheckIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const kinds = {
  does: { mark: CheckIcon, card: "surface lift", markTone: "bg-gold/15 text-highlight" },
  /** What the AI must never do, on a small ink panel lit like the hero. */
  doesNot: { mark: XIcon, card: "aurora relative overflow-clip text-foreground shadow-xl", markTone: "bg-foreground/10 text-highlight" },
} as const;

type CheckListProps = {
  title: string;
  items: readonly string[];
  kind: keyof typeof kinds;
};

/** A titled list of things the AI does, or does not do. */
export function CheckList({ title, items, kind }: CheckListProps) {
  const { mark: Mark, card, markTone } = kinds[kind];
  // The ink card switches the tokens inside it to the dark theme, so its text keeps its contrast.
  const theme = kind === "doesNot" ? { "data-theme": "dark" } : {};

  return (
    <div {...theme} className={cn("min-w-0 rounded-3xl p-6 sm:p-9", card)}>
      <h3 className="font-serif text-subtitle text-balance">{title}</h3>
      <ul className="mt-7 space-y-3.5">
        {items.map((item) => (
          <li key={item} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
            <span aria-hidden="true" className={cn("mt-0.5 grid size-6 place-items-center rounded-full", markTone)}>
              <Mark className="size-3.5" />
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
