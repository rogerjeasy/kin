import { CheckIcon, MinusIcon } from "lucide-react";

const marks = { does: CheckIcon, doesNot: MinusIcon } as const;

type CheckListProps = {
  title: string;
  items: readonly string[];
  kind: keyof typeof marks;
};

/** A titled list of things the AI does, or does not do. */
export function CheckList({ title, items, kind }: CheckListProps) {
  const Mark = marks[kind];

  return (
    <div className="min-w-0 rounded-3xl border bg-card p-6 sm:p-8">
      <h3 className="font-serif text-subtitle">{title}</h3>
      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          <li key={item} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3">
            <Mark aria-hidden="true" className="mt-1 size-5 text-highlight" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
