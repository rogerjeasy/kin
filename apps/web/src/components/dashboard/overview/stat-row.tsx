import { ArrowDownLeftIcon, ArrowUpRightIcon, BadgeCheckIcon, WalletIcon } from "lucide-react";

import { StatTile } from "@/components/dashboard/ui/stat-tile";

import { FeaturedStat } from "./featured-stat";

type Stat = { label: string; value: string; note: string };

type StatRowProps = {
  label: string;
  pool: Stat;
  paidIn: Stat;
  paidOut: Stat;
  waiting: Stat;
};

/**
 * The month's four headline figures. The pool leads, twice as wide; on a
 * phone it spans the row and the last figure does too, so no tile is alone.
 */
export function StatRow({ label, pool, paidIn, paidOut, waiting }: StatRowProps) {
  return (
    <dl aria-label={label} className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5 [&>*:first-child]:col-span-2 [&>*:last-child]:col-span-2 xl:[&>*:last-child]:col-span-1">
      <FeaturedStat icon={WalletIcon} {...pool} />
      <StatTile icon={ArrowDownLeftIcon} {...paidIn} />
      <StatTile icon={ArrowUpRightIcon} {...paidOut} />
      <StatTile icon={BadgeCheckIcon} {...waiting} />
    </dl>
  );
}
