import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const tones = {
  positive: "bg-positive/10 text-positive ring-positive/20",
  waiting: "bg-highlight/10 text-highlight ring-highlight/25",
  danger: "bg-danger/10 text-danger ring-danger/20",
  neutral: "bg-secondary text-muted-foreground ring-border",
} as const;

export type PillTone = keyof typeof tones;

type StatusPillProps = { tone: PillTone; icon?: LucideIcon; className?: string; children: string };

/** A short state, in words and colour, with an icon so colour is never the only sign. */
export function StatusPill({ tone, icon: Icon, className, children }: StatusPillProps) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", tones[tone], className)}>
      {Icon ? (
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      ) : (
        <span aria-hidden="true" className="relative inline-flex size-1.5 shrink-0">
          {tone === "waiting" ? <span className="absolute inset-0 rounded-full bg-current opacity-60 motion-safe:animate-dot-ping" /> : null}
          <span className="relative size-1.5 rounded-full bg-current" />
        </span>
      )}
      <span className="min-w-0">{children}</span>
    </span>
  );
}
