"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** Every motion component follows the reader's reduced-motion setting. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
