import { cn } from "@/lib/utils";

import { KNOT_MARK, knot, strandPath } from "./knot-geometry";

const { strands, centre } = knot(KNOT_MARK);

/** The Kin mark: one unbroken line in three lobes, tied around the parent at its centre. */
export function KnotMark({ className }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${KNOT_MARK.size} ${KNOT_MARK.size}`} aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <g fill="none" strokeWidth={KNOT_MARK.strokeWidth} className="stroke-primary">
        {strands.map((strand, index) => (
          <path key={index} d={strandPath(strand)} />
        ))}
      </g>
      <circle cx={centre.x} cy={centre.y} r={KNOT_MARK.centreRadius} className="fill-highlight" />
    </svg>
  );
}
