import { PlusIcon } from "lucide-react";

type FaqListProps = { items: readonly { question: string; answer: string }[] };

/**
 * Questions that open to show their answers. The browser's own disclosure
 * element does the work, so it needs no script and works by keyboard.
 */
export function FaqList({ items }: FaqListProps) {
  return (
    <div className="border-t">
      {items.map((item) => (
        <details key={item.question} className="group border-b">
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden">
            <h3 className="min-w-0 text-lg font-semibold">{item.question}</h3>
            <PlusIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-45" />
          </summary>
          <p className="max-w-2xl pb-6 text-lg text-muted-foreground">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
