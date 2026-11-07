import Link from "next/link";

import { ANNOUNCE_EVERY, type AnnounceEvery } from "@/content/circle/announcements";
import type { Dictionary } from "@/i18n/dictionary";
import { cn } from "@/lib/utils";

type Props = { current: AnnounceEvery; href: (every: AnnounceEvery) => string; copy: Dictionary["dashboard"]["listen"] };

/** How often the parent hears money events. Plain links: the choice is in the address, so it needs no script. */
export function EveryChoice({ current, href, copy }: Props) {
  return (
    <nav aria-label={copy.everyLabel}>
      <ul className="flex flex-wrap gap-3">
        {ANNOUNCE_EVERY.map((every) => (
          <li key={every} className="min-w-0">
            <Link
              href={href(every)}
              aria-current={every === current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-12 items-center rounded-xl border-2 px-5 text-lg font-semibold",
                every === current ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:border-foreground",
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
