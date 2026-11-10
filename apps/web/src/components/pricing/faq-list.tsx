import { PlusIcon } from "lucide-react";

type FaqListProps = { items: readonly { question: string; answer: string }[] };

/**
 * Questions that open to show their answers. The browser's own disclosure
 * element does the work, so it needs no script and works by keyboard. Each is
 * a lit card that warms with a gold edge while it is open.
 */
export function FaqList({ items }: FaqListProps) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <details key={item.question} className="group surface rounded-2xl transition-shadow duration-500 open:border-gold/50 open:shadow-md">
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-4 sm:px-6 [&::-webkit-details-marker]:hidden">
            <h3 className="min-w-0 text-lg font-semibold">{item.question}</h3>
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full border border-input transition-[transform,background-color,border-color] duration-500 ease-(--ease-out-expo) group-open:rotate-45 group-open:border-gold group-open:bg-gold/15">
              <PlusIcon className="size-4 text-highlight" />
            </span>
          </summary>
          <p className="max-w-2xl px-5 pb-6 text-lg text-muted-foreground sm:px-6">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
