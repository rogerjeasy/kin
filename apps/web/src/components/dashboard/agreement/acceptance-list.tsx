import { CheckIcon, ClockIcon } from "lucide-react";

export type AcceptanceItem = { readonly memberId: string; readonly name: string; readonly detail: string; readonly accepted: boolean };

/** Who has accepted a version, and whose acceptance it still waits for. */
export function AcceptanceList({ title, items }: { title: string; items: readonly AcceptanceItem[] }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 font-semibold">{title}</h3>
      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.memberId} className="flex min-w-0 items-start gap-3 py-2.5">
            <span aria-hidden="true" className={`mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full ring-1 ${item.accepted ? "bg-positive/10 text-positive ring-positive/30 shadow-[0_0_14px_-4px_var(--positive)]" : "bg-highlight/10 text-highlight ring-gold/40 motion-safe:animate-glow-pulse"}`}>
              {item.accepted ? <CheckIcon className="size-3.5" /> : <ClockIcon className="size-3.5" />}
            </span>
            <span className="min-w-0">
              <span className="block font-medium wrap-anywhere">{item.name}</span>
              <span className="block text-sm text-muted-foreground">{item.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
