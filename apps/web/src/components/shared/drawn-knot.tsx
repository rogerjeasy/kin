"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";

import { KNOT_MARK, knot, strandPath } from "@/components/brand/knot-geometry";
import { cn } from "@/lib/utils";

const { strands, centre } = knot(KNOT_MARK);
const EASE = [0.16, 1, 0.3, 1] as const;
const STAGGER = 0.35;

type Draw = { index: number; still: boolean };

// The strands always start undrawn, so the server's markup and the browser's
// agree; a reader who asks for less motion gets them drawn at once.
const strand: Variants = {
  hidden: { pathLength: 0 },
  shown: ({ index, still }: Draw) => ({
    pathLength: 1,
    transition: still ? { duration: 0 } : { duration: 1.6, delay: 0.2 + index * STAGGER, ease: EASE },
  }),
};

const heart: Variants = {
  hidden: { scale: 0 },
  shown: { scale: 1, transition: { type: "spring", stiffness: 260, damping: 14, delay: 0.6 + strands.length * STAGGER } },
};

/**
 * The Kin knot drawn in gold: when it comes into view its three strands trace
 * themselves one after another, then the parent's point of light appears at
 * the centre. Decorative.
 */
export function DrawnKnot({ className }: { className?: string }) {
  const still = useReducedMotion() ?? false;

  return (
    <motion.svg
      viewBox={`0 0 ${KNOT_MARK.size} ${KNOT_MARK.size}`}
      aria-hidden="true"
      className={cn("overflow-visible", className)}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount: 0.4 }}
    >
      <g fill="none" strokeWidth={KNOT_MARK.strokeWidth * 0.8} strokeLinecap="round" className="stroke-gold">
        {strands.map((line, index) => (
          <motion.path key={index} d={strandPath(line)} custom={{ index, still } satisfies Draw} variants={strand} />
        ))}
      </g>
      <motion.circle cx={centre.x} cy={centre.y} r={KNOT_MARK.centreRadius} variants={heart} className="fill-band-highlight" />
    </motion.svg>
  );
}
