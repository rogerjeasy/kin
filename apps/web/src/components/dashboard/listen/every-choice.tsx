import Link from "next/link";

import { ANNOUNCE_EVERY, type AnnounceEvery } from "@/content/circle/announcements";
import type { Dictionary } from "@/i18n/dictionary";
import { cn } from "@/lib/utils";

type Props = { current: AnnounceEvery; href: (every: AnnounceEvery) => string; copy: Dictionary["dashboard"]["listen"] };

/** How often the parent hears money events. Plain links: the choice is in the address, so it needs no script. */
export function EveryChoice({ current, href, copy }: Props) {
  return (
    <nav aria-label={copy.everyLabel} className="min-w-0">
      <ul className="inline-flex max-w-full flex-wrap gap-1.5 rounded-[1.75rem] border bg-secondary/70 p-1.5 shadow-[inset_0_1px_2px_var(--shadow-tint-1)]">
        {ANNOUNCE_EVERY.map((every) => (
          <li key={every} className="min-w-0">
            <Link
              href={href(every)}
              aria-current={every === current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-14 items-center rounded-3xl px-6 text-lg font-semibold transition-[background-color,color,box-shadow] duration-300 ease-(--ease-out-expo) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                every === current ? "bg-foreground text-background shadow-[0_8px_24px_-8px_rgb(var(--glow-gold)/0.7)]" : "text-foreground hover:bg-card",
              )}
            >
              {copy.every[every]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
