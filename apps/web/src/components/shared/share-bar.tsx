import { BASIS_POINTS } from "@kin/domain";

import { shareColorAt } from "./share-colors";

/** One share of an agreement, in basis points, in the agreement's order. */
export type ShareSegment = { readonly key: string; readonly bps: number };

const WIDTH = 100;
const HEIGHT = 4;
const GAP = 0.8;

/**
 * The agreed shares as one bar, cut where each share ends. The legend names
 * each colour, so the bar needs only a sentence for readers who cannot see it.
 */
export function ShareBar({ label, shares }: { label: string; shares: readonly ShareSegment[] }) {
  // Each share starts where the one before it ended. Widths are a drawing, not money.
  const segments = shares.map((share, index) => ({
    key: share.key,
    start: (shares.slice(0, index).reduce((sum, earlier) => sum + earlier.bps, 0) / BASIS_POINTS) * WIDTH,
    width: (share.bps / BASIS_POINTS) * WIDTH - (index === shares.length - 1 ? 0 : GAP),
  }));
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} preserveAspectRatio="none" className="block h-3.5 w-full rtl:-scale-x-100">
      {segments.map((segment, index) => (
        <rect key={segment.key} x={segment.start} width={Math.max(segment.width, 0)} height={HEIGHT} rx="1" className={shareColorAt(index).fill} />
      ))}
    </svg>
  );
}
