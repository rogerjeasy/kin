import type { ReactNode } from "react";

/**
 * A template mounts anew on every move between the circle's screens, so each
 * screen's regions rise into place one after another instead of cutting in.
 * Pages return their regions as siblings, so the spacing between them lives
 * here. The motion is CSS (`enter-stagger`), skipped for reduced motion.
 */
export default function DashboardTemplate({ children }: { children: ReactNode }) {
  return <div className="enter-stagger min-w-0 space-y-6 lg:space-y-8">{children}</div>;
}
