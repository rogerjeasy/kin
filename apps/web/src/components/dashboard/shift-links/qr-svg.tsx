import type { QrCode } from "@/server/qr-code";
import { cn } from "@/lib/utils";

/**
 * A QR code drawn from the server's path. A scanner needs dark on light with a
 * quiet border whatever the page's theme, so the code carries its own white
 * ground and black cells, and never follows dark mode.
 */
export function QrSvg({ code, label, className }: { code: QrCode; label: string; className?: string }) {
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${code.size} ${code.size}`} shapeRendering="crispEdges" className={cn("aspect-square h-auto w-full rounded-lg bg-white text-black", className)}>
      <path d={code.path} fill="currentColor" />
    </svg>
  );
}
