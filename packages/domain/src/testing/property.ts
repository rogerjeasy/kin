/**
 * A small property-test harness. Each run draws its input from a generator
 * seeded with the run number, so a failure names the seed that reproduces it
 * and no test depends on real randomness.
 */
export type Random = {
  /** A whole number from `min` to `max`, both included. */
  int(min: number, max: number): number;
  pick<T>(items: readonly [T, ...T[]]): T;
  shuffle<T>(items: readonly T[]): T[];
};

const DEFAULT_RUNS = 300;

export function forAll<T>(
  generate: (random: Random) => T,
  check: (value: T) => void,
  runs = DEFAULT_RUNS,
): void {
  for (let seed = 1; seed <= runs; seed += 1) {
    const value = generate(seededRandom(seed));
    try {
      check(value);
    } catch (error) {
      throw new Error(
        `Property failed for seed ${seed} with input ${JSON.stringify(value)}`,
        { cause: error },
      );
    }
  }
}

export function seededRandom(seed: number): Random {
  const next = mulberry32(seed);
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1));
  return {
    int,
    pick: (items) => items[int(0, items.length - 1)] ?? items[0],
    shuffle: (items) =>
      items
        .map((item) => ({ item, key: next() }))
        .toSorted((a, b) => a.key - b.key)
        .map(({ item }) => item),
  };
}

// Mulberry32: a tiny generator with a full 32-bit period, enough to vary test
// inputs. It is never used on money itself.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
