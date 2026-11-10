import { HourglassIcon } from "lucide-react";
import type { PurseHoldReason } from "@kin/domain";

import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

type Props = { reasons: readonly PurseHoldReason[]; payee: string; cap: string; copy: Dictionary["dashboard"]["purse"]; className?: string };

/** Why Kin waits a day before a payment goes, in plain words, each one plain code decided. */
export function HoldReasons({ reasons, payee, cap, copy, className }: Props) {
  if (reasons.length === 0) return null;
  return (
    <div className={className}>
      <p className="flex items-center gap-2 font-semibold">
        <HourglassIcon aria-hidden="true" className="size-5 shrink-0 text-highlight" />
        {copy.reasonsTitle}
      </p>
      <ul className="mt-2 list-disc space-y-1 ps-6 text-base">
        {reasons.map((reason) => (
          <li key={reason} className="wrap-anywhere">
            {fill(copy.reasons[reason], { payee, cap })}
          </li>
        ))}
      </ul>
    </div>
  );
}
