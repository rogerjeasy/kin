import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type SlotItem = {
  /** What this place asks for: "Rose decides above $50.00". */
  title: string;
  /** Who filled it and how, or who it waits for. */
  detail: string;
  /** A further line, such as when Kin will ask Rose. */
  note?: string;
  filled: boolean;
};

type ApprovalSlotsProps = { label: string; progress: string; slots: readonly SlotItem[] };

/** Each yes a proposal needs, in order, filled or still open. */
export function ApprovalSlots({ label, progress, slots }: ApprovalSlotsProps) {
  return (
    <div className="rounded-xl bg-muted p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{label}</h3>
        <p className="text-sm text-muted-foreground tabular-nums">{progress}</p>
      </div>
      <ol className="mt-4 space-y-4">
        {slots.map((slot) => (
          <li key={slot.title} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-full border-2",
                slot.filled ? "border-positive bg-positive text-card" : "border-dashed border-input bg-card",
              )}
            >
              {slot.filled ? <CheckIcon className="size-4" strokeWidth={3} /> : null}
            </span>
            <div className="min-w-0">
              <p className="font-medium">{slot.title}</p>
              <p className={cn("mt-0.5 text-sm", slot.filled ? "text-positive" : "text-muted-foreground")}>{slot.detail}</p>
              {slot.note ? <p className="mt-0.5 text-sm text-muted-foreground">{slot.note}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
