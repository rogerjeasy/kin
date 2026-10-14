import roseFace from "@/assets/images/rose-face.jpg";
import { RING_LENGTH, pointOnRing, ringSegments } from "@/components/brand/ring-geometry";
import { exampleFamily } from "@/content/example-family";
import { siblingPortraits } from "@/content/sibling-portraits";

const SIZE = 520;
/** The drawing leaves empty bands above and below the ring. The view crops them. */
const CROP = 50;
const RING = { centre: SIZE / 2, radius: 190 };
const GAP = 1;
const ROSE_RADIUS = 112;
const FACE_RADIUS = 38;
/** A disc in the section's colour behind each face, so the ring appears to pass under it. */
const HALO_RADIUS = 46;

const shareStrokes = ["stroke-share-1", "stroke-share-2", "stroke-share-3"] as const;

const segments = ringSegments(
  exampleFamily.shares.map((share) => share.percent),
  GAP,
);

function Portrait({ id, href, x, y, radius }: { id: string; href: string; x: number; y: number; radius: number }) {
  return (
    <>
      <clipPath id={id}>
        <circle cx={x} cy={y} r={radius} />
      </clipPath>
      <image
        href={href}
        x={x - radius}
        y={y - radius}
        width={radius * 2}
        height={radius * 2}
        preserveAspectRatio="xMidYMid slice"
        clipPath={`url(#${id})`}
      />
    </>
  );
}

/** Rose in the middle of a ring cut into her children's agreed shares. */
export function ShareRing({ label }: { label: string }) {
  return (
    <svg viewBox={`0 ${CROP} ${SIZE} ${SIZE - CROP * 2}`} role="img" aria-label={label} className="mx-auto block h-auto w-full max-w-lg">
      <g transform={`rotate(-90 ${RING.centre} ${RING.centre})`} fill="none" strokeWidth="18">
        {segments.map((segment, index) => (
          <circle
            key={index}
            cx={RING.centre}
            cy={RING.centre}
            r={RING.radius}
            pathLength={RING_LENGTH}
            strokeDasharray={`${segment.length} ${RING_LENGTH - segment.length}`}
            strokeDashoffset={segment.offset}
            className={shareStrokes[index]}
          />
        ))}
      </g>
      <Portrait id="share-ring-rose" href={roseFace.src} x={RING.centre} y={RING.centre} radius={ROSE_RADIUS} />
      {exampleFamily.shares.map((share, index) => {
        const { x, y } = pointOnRing(RING, segments[index]?.middle ?? 0);
        return (
          <g key={share.member}>
            <circle cx={x} cy={y} r={HALO_RADIUS} strokeWidth="4" className={`fill-muted ${shareStrokes[index] ?? ""}`} />
            <Portrait id={`share-ring-${share.member}`} href={siblingPortraits[share.member].src} x={x} y={y} radius={FACE_RADIUS} />
          </g>
        );
      })}
    </svg>
  );
}
