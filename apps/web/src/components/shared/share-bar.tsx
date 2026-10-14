import { exampleFamily } from "@/content/example-family";

const WIDTH = 100;
const HEIGHT = 4;
const GAP = 0.8;

const fills = ["fill-share-1", "fill-share-2", "fill-share-3"] as const;

// Each share starts where the one before it ended.
const segments = exampleFamily.shares.map((share, index, shares) => ({
  member: share.member,
  start: shares.slice(0, index).reduce((sum, earlier) => sum + earlier.percent, 0),
  width: share.percent - (index === shares.length - 1 ? 0 : GAP),
}));

/**
 * The agreed shares as one bar cut in three. The legend names each colour, so
 * the bar needs only a sentence for readers who cannot see it.
 */
export function ShareBar({ label }: { label: string }) {
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} preserveAspectRatio="none" className="block h-3.5 w-full rtl:-scale-x-100">
      {segments.map((segment, index) => (
        <rect key={segment.member} x={segment.start} width={segment.width} height={HEIGHT} rx="1" className={fills[index]} />
      ))}
    </svg>
  );
}
