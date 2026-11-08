import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import type { ShiftWeek } from "@/content/circle/shift-week";
import type { ShiftCopy } from "@/content/circle/shift-words";

type Props = { week: ShiftWeek; copy: ShiftCopy["week"]; path: string };

const link = "inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-medium hover:bg-accent";

/** Plain links to the weeks around the one on show. The week is in the address, so it can be shared and the back button works. */
export function ShiftWeekNav({ week, copy, path }: Props) {
  const hrefOf = (start: string) => `${path}?week=${start}`;
  return (
    <nav aria-label={copy.navLabel} className="flex flex-wrap items-center gap-2">
      <Link href={hrefOf(week.previous)} className={link} rel="prev">
        <ChevronLeftIcon aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        {copy.previous}
      </Link>
      <Link href={hrefOf(week.next)} className={link} rel="next">
        {copy.next}
        <ChevronRightIcon aria-hidden="true" className="size-4 rtl:-scale-x-100" />
      </Link>
      {week.current ? null : (
        <Link href={path} className={link}>
          {copy.back}
        </Link>
      )}
    </nav>
  );
}
