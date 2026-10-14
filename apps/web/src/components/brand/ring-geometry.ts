/**
 * Geometry for the Kin ring: a circle whose length is 100 units, split into one
 * arc per share. Positions run clockwise from the top, in the same units.
 */
export type RingSegment = {
  /** Length of the visible arc. */
  length: number;
  /** stroke-dashoffset that puts the arc in its place. */
  offset: number;
  /** Position of the arc's midpoint along the ring. */
  middle: number;
};

export type Ring = { centre: number; radius: number };

export const RING_LENGTH = 100;

export function ringSegments(percents: readonly number[], gap: number): RingSegment[] {
  let start = 0;
  return percents.map((percent) => {
    const segment = {
      length: percent - gap,
      offset: -(start + gap / 2),
      middle: start + percent / 2,
    };
    start += percent;
    return segment;
  });
}

export function pointOnRing(ring: Ring, position: number): { x: number; y: number } {
  const angle = (position / RING_LENGTH) * 2 * Math.PI;
  return {
    x: round(ring.centre + ring.radius * Math.sin(angle)),
    y: round(ring.centre - ring.radius * Math.cos(angle)),
  };
}

// Two decimals is finer than a pixel and keeps the markup stable between builds.
export function round(value: number): number {
  return Math.round(value * 100) / 100;
}
