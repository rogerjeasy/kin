import { useId } from "react";

import type { GridCopy } from "@/components/data-grid/data-grid";

import { GROUP_BYS, type GroupBy } from "./ledger-row.ts";

type LedgerGroupSelectProps = { value: GroupBy; onChange: (value: GroupBy) => void; copy: GridCopy["toolbar"] };

/** Chooses how the entries are grouped under subtotals. A native select, so every device and screen reader knows it. */
export function LedgerGroupSelect({ value, onChange, copy }: LedgerGroupSelectProps) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-muted-foreground">
        {copy.group}
      </label>
      <select id={id} value={value} onChange={(event) => onChange(GROUP_BYS.find((each) => each === event.target.value) ?? "none")} className="min-h-11 rounded-full border border-input bg-card px-4 shadow-2xs transition-[border-color,box-shadow] duration-300 focus-visible:border-gold focus-visible:shadow-[0_0_0_4px_rgb(var(--glow-gold)/0.16)] text-base">
        {GROUP_BYS.map((each) => (
          <option key={each} value={each}>
            {copy.groups[each]}
          </option>
        ))}
      </select>
    </div>
  );
}
