import { round } from "./ring-geometry.ts";

/**
 * Geometry for the Kin knot: one closed line woven into three lobes. Where the
 * line passes under itself it is broken, so the knot is drawn as three strands
 * with nothing behind them and sits on any background.
 */
export type Point = { x: number; y: number };

/** One cubic Bézier segment, ending at `end`. */
export type Curve = { control1: Point; control2: Point; end: Point };

export type Strand = { start: Point; curves: Curve[] };

export type Knot = { strands: Strand[]; centre: Point };

export type KnotSpec = {
  /** Side of the square box the inked line fills. */
  size: number;
  strokeWidth: number;
  /** Clear space on each side of a strand where another passes under it. */
  gap: number;
};

/** The proportions of the Kin mark, shared by the logo and the site icon. */
export const KNOT_MARK = { size: 64, strokeWidth: 5, gap: 2.5, centreRadius: 4 } as const;

const TURN = 2 * Math.PI;
const THIRD = TURN / 3;
/**
 * The trefoil crosses itself where cos t = -1/4. The line passes under at this
 * angle, over at its negative, and again a third of a turn on from each.
 */
const UNDER = Math.acos(-1 / 4);
const CURVES_PER_STRAND = 6;
const BOUNDS_SAMPLES = 720;

/** The trefoil at its natural size, with one lobe pointing up. */
function trefoil(t: number): Point {
  return { x: Math.sin(t) + 2 * Math.sin(2 * t), y: Math.cos(t) - 2 * Math.cos(2 * t) };
}

function velocity(t: number): Point {
  return { x: Math.cos(t) + 4 * Math.cos(2 * t), y: -Math.sin(t) + 4 * Math.sin(2 * t) };
}

function bounds(): { left: number; right: number; top: number; bottom: number } {
  const points = Array.from({ length: BOUNDS_SAMPLES }, (_, index) => trefoil((index / BOUNDS_SAMPLES) * TURN));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

/** How far along the line, as an angle, a strand stops before the one above it. */
function underpassCut(spec: KnotSpec, scale: number): number {
  const under = velocity(UNDER);
  const over = velocity(-UNDER);
  const speed = Math.hypot(under.x, under.y);
  const sineOfCrossing = Math.abs(under.x * over.y - under.y * over.x) / speed ** 2;
  return (spec.strokeWidth / 2 + spec.gap) / (sineOfCrossing * speed * scale);
}

export function knot(spec: KnotSpec): Knot {
  const box = bounds();
  const scale = (spec.size - spec.strokeWidth) / Math.max(box.right - box.left, box.bottom - box.top);
  const origin = {
    x: spec.size / 2 - ((box.left + box.right) / 2) * scale,
    y: spec.size / 2 - ((box.top + box.bottom) / 2) * scale,
  };
  const place = (point: Point): Point => ({ x: round(origin.x + point.x * scale), y: round(origin.y + point.y * scale) });

  const cut = underpassCut(spec, scale);
  const step = (THIRD - 2 * cut) / CURVES_PER_STRAND;
  // A third of each end's velocity gives the cubic that leaves and arrives in the line's own direction.
  const handle = (t: number, direction: 1 | -1): Point => {
    const point = trefoil(t);
    const speed = velocity(t);
    return place({ x: point.x + (direction * step * speed.x) / 3, y: point.y + (direction * step * speed.y) / 3 });
  };

  const strands = [0, 1, 2].map((lobe) => {
    const from = UNDER + lobe * THIRD + cut;
    return {
      start: place(trefoil(from)),
      curves: Array.from({ length: CURVES_PER_STRAND }, (_, index) => {
        const a = from + index * step;
        const b = a + step;
        return { control1: handle(a, 1), control2: handle(b, -1), end: place(trefoil(b)) };
      }),
    };
  });

  return { strands, centre: place({ x: 0, y: 0 }) };
}

export function strandPath(strand: Strand): string {
  const curves = strand.curves.map(
    ({ control1, control2, end }) => `C${control1.x} ${control1.y} ${control2.x} ${control2.y} ${end.x} ${end.y}`,
  );
  return `M${strand.start.x} ${strand.start.y}${curves.join("")}`;
}
