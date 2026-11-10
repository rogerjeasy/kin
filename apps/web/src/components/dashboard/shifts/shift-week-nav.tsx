import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import type { ShiftWeek } from "@/content/circle/shift-week";
import type { ShiftCopy } from "@/content/circle/shift-words";

type Props = { week: ShiftWeek; copy: ShiftCopy["week"]; path: string };

const link =
  "group inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-medium shadow-2xs transition-[background-color,box-shadow,border-color] duration-300 hover:border-foreground/30 hover:bg-accent hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Plain links to the weeks around the one on show. The week is in the address, so it can be shared and the back button works. */
export function ShiftWeekNav({ week, copy, path }: Props) {
  const hrefOf = (start: string) => `${path}?week=${start}`;
  return (
    <nav aria-label={copy.navLabel} className="flex flex-wrap items-center gap-2">
      <Link href={hrefOf(week.previous)} className={link} rel="prev">
        <ChevronLeftIcon aria-hidden="true" className="size-4 transition-transform duration-300 group-hover:-translate-x-0.5 rtl:-scale-x-100" />
        {copy.previous}
      </Link>
      <Link href={hrefOf(week.next)} className={link} rel="next">
        {copy.next}
        <ChevronRightIcon aria-hidden="true" className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 rtl:-scale-x-100" />
      </Link>
      {week.current ? null : (
        <Link href={path} className={link}>
          {copy.back}
        </Link>
      )}
    </nav>
  );
}
