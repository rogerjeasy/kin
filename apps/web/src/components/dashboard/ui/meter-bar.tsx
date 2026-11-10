import { cn } from "@/lib/utils";

const WIDTH = 100;
const HEIGHT = 10;
const TICK = 0.6;

type MeterBarProps = {
  value: number;
  /** The value at the bar's full length. */
  max: number;
  /** A mark across the bar, such as an agreed share. */
  target?: number;
  /** The fill's colour class, such as `fill-share-1`. */
  fill: string;
  /** What the bar shows, in words, for a reader who cannot see it. */
  label: string;
  className?: string;
};

/** One horizontal bar on a track, with an optional mark for a target. */
export function MeterBar({ value, max, target, fill, label, className }: MeterBarProps) {
  const scale = (amount: number) => (max <= 0 ? 0 : Math.min(WIDTH, (Math.max(0, amount) / max) * WIDTH));
  const filled = scale(value);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cn("block h-3 w-full overflow-visible rtl:-scale-x-100", className)}
    >
      <rect width={WIDTH} height={HEIGHT} rx={HEIGHT / 2} className="fill-muted" />
      {filled > 0 ? <rect width={filled} height={HEIGHT} rx={HEIGHT / 2} className={cn("grow-bar", fill)} /> : null}
      {target === undefined ? null : (
        <rect x={scale(target) - TICK / 2} y={-3} width={TICK} height={HEIGHT + 6} className="fill-foreground" />
      )}
    </svg>
  );
}
