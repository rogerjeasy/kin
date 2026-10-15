import { ArrowDownLeftIcon, ArrowUpRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type FlowAmountProps = {
  amount: string;
  /** Into the pool, out of it, or neither, such as an approval or care time. */
  flow: "in" | "out" | "none";
  className?: string;
};

/**
 * An amount with the way it moved the pool. The arrow and colour repeat what
 * the entry's name already says, so neither is the only sign.
 */
export function FlowAmount({ amount, flow, className }: FlowAmountProps) {
  return (
    <span className={cn("inline-flex items-center gap-1 font-semibold whitespace-nowrap tabular-nums", flow === "in" && "text-positive", flow === "none" && "text-muted-foreground", className)}>
      {flow === "in" ? <ArrowDownLeftIcon aria-hidden="true" className="size-4" /> : null}
      {flow === "out" ? <ArrowUpRightIcon aria-hidden="true" className="size-4 text-muted-foreground" /> : null}
      {amount}
    </span>
  );
}
