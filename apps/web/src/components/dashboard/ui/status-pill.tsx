import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const tones = {
  positive: "bg-positive/10 text-positive",
  waiting: "bg-highlight/10 text-highlight",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-secondary text-muted-foreground",
} as const;

export type PillTone = keyof typeof tones;

type StatusPillProps = { tone: PillTone; icon?: LucideIcon; className?: string; children: string };

/** A short state, in words and colour, with an icon so colour is never the only sign. */
export function StatusPill({ tone, icon: Icon, className, children }: StatusPillProps) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", tones[tone], className)}>
      {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
      <span className="min-w-0">{children}</span>
    </span>
  );
}
