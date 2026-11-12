import { useId, type ReactNode } from "react";

type Props = { title: string; text: string; children: ReactNode };

/**
 * The overview's helpers, together and below the money: the false-demand
 * check, "Is it really you?", the parent's Purse and wishes, quiet shares and
 * connected assistants, as one grid of small tiles.
 */
export function ProtectionSection({ title, text, children }: Props) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-4">
      <div className="min-w-0">
        <h2 id={headingId} className="text-xl font-semibold tracking-tight text-balance">
          {title}
        </h2>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">{text}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}
