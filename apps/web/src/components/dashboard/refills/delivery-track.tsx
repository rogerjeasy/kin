import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type Props = {
  /** The steps in order, each with its words. */
  steps: readonly { readonly key: string; readonly label: string }[];
  /** The step the order has reached. */
  current: string;
  label: string;
};

/** An order's way to the door: the steps it has taken, the one it is at, and those still to come. */
export function DeliveryTrack({ steps, current, label }: Props) {
  const at = steps.findIndex((step) => step.key === current);
  return (
    <ol aria-label={label} className="grid min-w-0 gap-2 sm:grid-cols-4">
      {steps.map((step, index) => {
        const reached = index <= at;
        return (
          <li
            key={step.key}
            aria-current={index === at ? "step" : undefined}
            className={cn("flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm", reached ? "border-positive/40 bg-positive/10 font-semibold" : "text-muted-foreground")}
          >
            <span aria-hidden="true" className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", reached && "border-positive bg-positive text-background")}>
              {reached ? <CheckIcon className="size-3" /> : null}
            </span>
            <span className="min-w-0 text-pretty">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
