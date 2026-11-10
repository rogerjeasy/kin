"use client";

import { motion, useScroll, useSpring } from "motion/react";
import { useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * The line that joins the days: a faint rail, and over it a line of gold
 * light that fills as the reader moves down the month. Decorative. For a
 * reader who asks for less motion a stylesheet rule shows the whole line lit.
 */
export function TimelineLine({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 70%", "end 60%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });

  return (
    <div ref={ref} aria-hidden="true" className={cn("pointer-events-none absolute top-2 bottom-8 w-px -translate-x-1/2 rtl:translate-x-1/2", className)}>
      <div className="absolute inset-0 bg-linear-to-b from-border via-border to-transparent" />
      <motion.div
        className="absolute inset-0 origin-top bg-linear-to-b from-gold via-gold to-gold/0 shadow-[0_0_10px_1px_rgb(var(--glow-gold)/0.6)] motion-reduce:[transform:none!important]"
        style={{ scaleY: progress }}
      />
    </div>
  );
}
