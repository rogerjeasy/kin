import { cn } from "@/lib/utils";

import { DrawnKnot } from "./drawn-knot";

/**
 * The knot as a source of light: a warm glow behind it, a fine ring around it
 * and a bead of gold travelling that ring. Purely decorative, for ink panels.
 */
export function GlowKnot({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("relative grid aspect-square place-items-center", className)}>
      <div className="absolute inset-[18%] rounded-full bg-gold/25 blur-3xl motion-safe:animate-glow-pulse" />
      <div className="absolute inset-0 rounded-full border border-gold/15" />
      <div className="absolute inset-[9%] rounded-full border border-dashed border-gold/25" />
      <div className="absolute inset-0 motion-safe:animate-spin-slow">
        <span className="absolute start-1/2 top-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold shadow-[0_0_12px_2px_rgb(var(--glow-gold)/0.7)] rtl:translate-x-1/2" />
      </div>
      <DrawnKnot className="relative size-[56%] drop-shadow-[0_0_14px_rgb(var(--glow-gold)/0.55)]" />
    </div>
  );
}
