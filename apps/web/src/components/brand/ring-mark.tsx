import { exampleFamily } from "@/content/example-family";
import { cn } from "@/lib/utils";

import { RING_LENGTH, ringSegments } from "./ring-geometry";

const SIZE = 28;
const RADIUS = 10.5;
const GAP = 5;

export const shareStrokes = ["stroke-share-1", "stroke-share-2", "stroke-share-3"] as const;

const segments = ringSegments(
  exampleFamily.shares.map((share) => share.percent),
  GAP,
);

/** The Kin mark: a circle shared 50, 30 and 20. */
export function RingMark({ className }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" className={cn("size-7 shrink-0", className)}>
      <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} fill="none" strokeWidth="3.2">
        {segments.map((segment, index) => (
          <circle
            key={index}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            pathLength={RING_LENGTH}
            strokeDasharray={`${segment.length} ${RING_LENGTH - segment.length}`}
            strokeDashoffset={segment.offset}
            className={shareStrokes[index]}
          />
        ))}
      </g>
    </svg>
  );
}
