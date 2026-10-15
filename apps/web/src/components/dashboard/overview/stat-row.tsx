import { ArrowDownLeftIcon, ArrowUpRightIcon, BadgeCheckIcon, WalletIcon } from "lucide-react";

import { StatTile } from "@/components/dashboard/ui/stat-tile";

type Stat = { label: string; value: string; note: string };

type StatRowProps = {
  label: string;
  pool: Stat;
  paidIn: Stat;
  paidOut: Stat;
  waiting: Stat;
};

/** The month's four headline figures. */
export function StatRow({ label, pool, paidIn, paidOut, waiting }: StatRowProps) {
  return (
    <dl aria-label={label} className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <StatTile icon={WalletIcon} {...pool} />
      <StatTile icon={ArrowDownLeftIcon} {...paidIn} />
      <StatTile icon={ArrowUpRightIcon} {...paidOut} />
      <StatTile icon={BadgeCheckIcon} {...waiting} />
    </dl>
  );
}
