import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { ProgressRing } from "./progress-ring";

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

/**
 * Each yes a proposal needs, in order, filled or still open, as a short path
 * that lights up as it fills. The first open place glows: it is the one the
 * proposal waits for now.
 */
export function ApprovalSlots({ label, progress, slots }: ApprovalSlotsProps) {
  const filled = slots.filter((slot) => slot.filled).length;
  const next = slots.findIndex((slot) => !slot.filled);

  return (
    <div className="min-w-0 self-start rounded-2xl border bg-muted/70 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <ProgressRing done={filled} total={slots.length} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{label}</h3>
          <p className="text-sm text-muted-foreground tabular-nums">{progress}</p>
        </div>
      </div>
      <ol className="mt-5 space-y-5">
        {slots.map((slot, index) => (
          <li
            key={slot.title}
            className={cn(
              "relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3",
              // The thread to the next place: lit once this one is filled.
              index < slots.length - 1 && "before:absolute before:start-[0.8125rem] before:top-8 before:-bottom-4 before:w-0.5 before:rounded-full",
              index < slots.length - 1 && (slot.filled ? "before:bg-positive/60" : "before:bg-border"),
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "relative inline-flex size-7 items-center justify-center rounded-full border-2 transition-shadow duration-500",
                slot.filled && "border-positive bg-positive text-card shadow-[0_0_0_4px_color-mix(in_oklab,var(--positive)_14%,transparent)]",
                !slot.filled && index === next && "border-gold bg-card motion-safe:animate-glow-pulse",
                !slot.filled && index !== next && "border-dashed border-input bg-card",
              )}
            >
              {slot.filled ? <CheckIcon className="size-4" strokeWidth={3} /> : null}
              {!slot.filled && index === next ? <span className="size-2 rounded-full bg-gold" /> : null}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="font-medium text-pretty">{slot.title}</p>
              <p className={cn("mt-0.5 text-sm text-pretty", slot.filled ? "font-medium text-positive" : "text-muted-foreground")}>{slot.detail}</p>
              {slot.note ? <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{slot.note}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
