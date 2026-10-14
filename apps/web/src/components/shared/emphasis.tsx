import type { ReactNode } from "react";

/**
 * The stressed half of a headline. Latin scripts get italics. Arabic and
 * Hebrew have no true italic, so they get the highlight colour instead.
 */
export function Emphasis({ children }: { children: ReactNode }) {
  return <em className="ltr:italic rtl:text-highlight rtl:not-italic">{children}</em>;
}
