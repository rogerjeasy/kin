const BAR_WIDTH = 3;
const BAR_STEP = 6;
const HEIGHT = 22;
const BARS = 36;
/** How many bars are drawn as already spoken. */
const SPOKEN = 14;

// Bar heights follow a fixed curve, so the picture is the same on every render.
const heights = Array.from({ length: BARS }, (_, index) => {
  const wave = Math.abs(Math.sin(index * 0.55) * Math.cos(index * 0.17));
  const ripple = Math.abs(Math.sin(index * 1.9));
  return Math.round(Math.min(HEIGHT, HEIGHT * (0.24 + 0.58 * wave + 0.18 * ripple)));
});

/** A decorative picture of speech. It carries no information. */
export function Waveform() {
  return (
    <svg
      viewBox={`0 0 ${BARS * BAR_STEP} ${HEIGHT}`}
      aria-hidden="true"
      preserveAspectRatio="xMinYMid meet"
      className="wave-bars h-5.5 min-w-0 flex-1 rtl:-scale-x-100"
    >
      {heights.map((height, index) => (
        <rect
          key={index}
          x={index * BAR_STEP}
          y={(HEIGHT - height) / 2}
          width={BAR_WIDTH}
          height={height}
          rx={BAR_WIDTH / 2}
          className={index < SPOKEN ? "fill-highlight" : "fill-border"}
        />
      ))}
    </svg>
  );
}
