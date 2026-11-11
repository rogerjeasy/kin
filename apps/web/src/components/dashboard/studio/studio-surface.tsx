"use client";

import { InfoIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { KinStudioProps } from "./kin-studio";
import { StudioBoundary } from "./studio-boundary";
import { studioLicence, type StudioLicence } from "./studio-licence";
import { ROOMY_WIDTH } from "./studio-report";
import { STUDIO_MIN_WIDTH } from "./studio-theme";

/** AG Studio is large and runs only in the browser: it loads when the page decides to show it, never on a phone. */
const KinStudio = dynamic(() => import("./kin-studio"), { ssr: false });

/** Built into the page at build time. Never committed: CI and the Dockerfile pass it from a secret. */
const LICENSE_KEY = process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE;

/** AG Studio's own reading of the key, for the studio with and without its AI module. */
async function readLicence(): Promise<StudioLicence> {
  const { AgStudioLicenseManager } = await import("ag-studio");
  const key = LICENSE_KEY ?? "";
  return studioLicence(AgStudioLicenseManager.getLicenseDetails(key, new Set(["PRO-AI"])), AgStudioLicenseManager.getLicenseDetails(key, new Set(["PRO"])));
}

type Phase = { kind: "deciding" } | { kind: "narrow" } | { kind: "lapsed" } | { kind: "failed" } | { kind: "studio"; ai: boolean };

function Note({ children }: { readonly children: string }) {
  return (
    <p className="flex items-start gap-2 rounded-2xl bg-secondary px-4 py-3 text-sm text-secondary-foreground">
      <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

type SurfaceProps = Omit<KinStudioProps, "licenseKey" | "roomy"> & {
  /** Kin's own read-only summary of the same record: what a phone, a lapsed licence or a failure shows. */
  readonly children: ReactNode;
};

/**
 * Where the studio goes on the page. Kin's summary is rendered first, so the
 * page reads whole before any script runs; once the browser knows the frame is
 * wide enough and AG Studio accepts the licence, the studio takes its place.
 */
export function StudioSurface({ children, agents, ...props }: SurfaceProps) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [licence, setLicence] = useState<StudioLicence | "failed" | null>(null);
  const wide = width === null ? null : width >= STUDIO_MIN_WIDTH;

  useEffect(() => {
    const element = frame.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (wide !== true || licence !== null) return;
    readLicence().then(setLicence, () => setLicence("failed"));
  }, [wide, licence]);

  const { notes } = props.copy;
  const phase: Phase =
    wide === null ? { kind: "deciding" } : !wide ? { kind: "narrow" } : licence === null ? { kind: "deciding" } : licence === "failed" ? { kind: "failed" } : licence.kind === "lapsed" ? { kind: "lapsed" } : { kind: "studio", ai: licence.ai };
  const summary = (note: string | null) => (
    <div className="flex min-w-0 flex-col gap-4">
      {note === null ? null : <Note>{note}</Note>}
      {children}
    </div>
  );

  return (
    <div ref={frame} className="min-w-0" data-studio-phase={phase.kind}>
      {phase.kind === "studio" ? (
        <StudioBoundary fallback={summary(notes.failed)}>
          <div className="h-[calc(100dvh-10rem)] min-h-[36rem] w-full min-w-0 overflow-hidden rounded-3xl">
            <KinStudio {...props} licenseKey={LICENSE_KEY} agents={phase.ai ? agents : null} roomy={(width ?? 0) >= ROOMY_WIDTH} />
          </div>
        </StudioBoundary>
      ) : (
        summary(phase.kind === "narrow" ? notes.narrow : phase.kind === "lapsed" ? notes.lapsed : phase.kind === "failed" ? notes.failed : null)
      )}
    </div>
  );
}
