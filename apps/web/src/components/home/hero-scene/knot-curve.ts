/**
 * The Kin knot in three dimensions: the same trefoil the logo draws
 * (`brand/knot-geometry.ts`), lifted off the page so its three lobes pass over
 * and under one another around the parent at its centre.
 */
export type Vec3 = readonly [number, number, number];

const TURN = 2 * Math.PI;

/** The trefoil at its natural size, one lobe pointing up, at `t` in [0, 1). */
export function trefoil3d(t: number): Vec3 {
  const a = t * TURN;
  return [Math.sin(a) + 2 * Math.sin(2 * a), Math.cos(a) - 2 * Math.cos(2 * a), -Math.sin(3 * a)];
}

/**
 * Which lobe a point of the line belongs to, and how far into it, so each
 * sibling's share colour fills one lobe and blends into the next at the
 * crossings. Returns the two lobes and the mix between them.
 */
export function lobeMix(t: number): { from: 0 | 1 | 2; to: 0 | 1 | 2; mix: number } {
  const position = (((t % 1) + 1) % 1) * 3;
  const from = Math.floor(position) % 3;
  const within = position - Math.floor(position);
  // Hold each lobe's colour through its middle and blend over the last fifth.
  const mix = within < 0.8 ? 0 : (within - 0.8) / 0.2;
  return { from: from as 0 | 1 | 2, to: ((from + 1) % 3) as 0 | 1 | 2, mix };
}
