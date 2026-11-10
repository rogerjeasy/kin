"use client";

import { CheckIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

const SIZE = 48;
const STROKE = 4;
const RADIUS = (SIZE - STROKE) / 2;

type ProgressRingProps = {
  done: number;
  total: number;
  className?: string;
};

/**
 * How far something has come, as a ring that draws itself in gold, with a
 * point of light at its centre that becomes a tick once it is complete. Decorative: the same progress is always said in words
 * beside it, so the ring is hidden from assistive technology and carries no
 * text of its own.
 */
export function ProgressRing({ done, total, className }: ProgressRingProps) {
  const still = useReducedMotion() ?? false;
  const ratio = total <= 0 ? 0 : Math.min(1, Math.max(0, done / total));
  const complete = total > 0 && done >= total;

  return (
    <span aria-hidden="true" className={cn("relative inline-flex size-12 shrink-0 items-center justify-center", className)}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 size-full -rotate-90 overflow-visible">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-border" />
        {ratio > 0 ? (
          <motion.circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            className={cn(complete ? "stroke-positive" : "stroke-gold", "drop-shadow-[0_0_4px_rgb(var(--glow-gold)/0.6)]")}
            initial={still ? false : { pathLength: 0 }}
            animate={{ pathLength: ratio }}
            transition={{ duration: 1.2, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
          />
        ) : null}
      </svg>
      {complete ? (
        <CheckIcon className="relative size-5 text-positive" strokeWidth={3} />
      ) : (
        <span className="relative size-2 rounded-full bg-gold shadow-[0_0_10px_2px_rgb(var(--glow-gold)/0.55)] motion-safe:animate-glow-pulse" />
      )}
    </span>
  );
}
