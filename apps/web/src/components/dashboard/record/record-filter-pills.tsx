import type { Dictionary } from "@/i18n/dictionary";
import { cn } from "@/lib/utils";

import { RECORD_FILTERS, type RecordFilter } from "./record-filters";

type RecordFilterPillsProps = {
  copy: Dictionary["dashboard"]["record"]["filters"];
  value: RecordFilter;
  onChange: (value: RecordFilter) => void;
};

/** One row of buttons that narrows the record to a kind of entry: money in, bills, purchases, care time. */
export function RecordFilterPills({ copy, value, onChange }: RecordFilterPillsProps) {
  return (
    <div role="group" aria-label={copy.label} className="flex flex-wrap gap-2 px-5 pb-4 sm:px-6 print:hidden">
      {RECORD_FILTERS.map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "min-h-11 rounded-full border px-4 text-sm font-medium transition-[background-color,color,box-shadow,border-color] duration-300 ease-(--ease-out-expo)",
            value === key
              ? "border-primary bg-primary text-primary-foreground shadow-[0_0_0_3px_rgb(var(--glow-gold)/0.22),var(--shadow-sm)]"
              : "border-input bg-card text-muted-foreground hover:border-gold/60 hover:text-foreground",
          )}
        >
          {copy[key]}
        </button>
      ))}
    </div>
  );
}
