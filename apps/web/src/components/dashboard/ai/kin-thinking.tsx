import { KinMark } from "./kin-mark";

const DOT = "size-1.5 rounded-full bg-highlight motion-safe:animate-bounce";

/**
 * Kin at work: its mark glowing, a bubble with what it is doing in words and
 * three dots that keep time. The words carry the meaning; the light is decoration.
 */
export function KinThinking({ label }: { label: string }) {
  return (
    <div className="flex min-w-0 items-end gap-3">
      <KinMark active />
      <div className="relative min-w-0 overflow-hidden rounded-3xl rounded-es-md border border-gold/40 bg-card px-4 py-3 shadow-[0_0_0_4px_rgb(var(--glow-gold)/0.08),var(--shadow-sm)]">
        <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium">
          <span className="min-w-0">{label}</span>
          <span aria-hidden="true" className="inline-flex items-center gap-1">
            <span className={DOT} />
            <span className={`${DOT} [animation-delay:150ms]`} />
            <span className={`${DOT} [animation-delay:300ms]`} />
          </span>
        </p>
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-gold/20">
          <span className="block h-full w-full bg-linear-to-r from-transparent via-gold to-transparent motion-safe:animate-shimmer" />
        </span>
      </div>
    </div>
  );
}
