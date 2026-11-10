"use client";

import { useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import Image, { type StaticImageData } from "next/image";
import { useEffect, useRef, useState } from "react";

import { KnotMark } from "@/components/brand/knot-mark";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

import { SceneBoundary } from "./scene-boundary";

// three.js loads only here, after the page is interactive, and never on the server.
const KnotScene = dynamic(() => import("./knot-scene"), { ssr: false });

// Renderers that draw WebGL on the processor. A moving scene there takes the
// whole page's time, so those browsers keep the still poster.
const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** True only where WebGL runs on a real graphics processor. */
function gpuAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (context === null) return false;
    const info = context.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(context.getParameter(context.RENDERER));
    return !SOFTWARE_RENDERERS.test(renderer);
  } catch {
    return false;
  }
}

type HeroVisualProps = { portrait: StaticImageData; className?: string };

/**
 * The hero's picture. First a still poster: the parent's portrait in a ring
 * of gold inside the Kin knot. Where WebGL runs on a graphics processor, the knot
 * becomes light and turns around her, and the poster fades away under it.
 * With reduced motion the poster stays.
 * Decorative: the words beside it carry the meaning.
 */
export function HeroVisual({ portrait, className }: HeroVisualProps) {
  const hydrated = useHydrated();
  const reduced = useReducedMotion() ?? false;
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [inView, setInView] = useState(true);
  const [canDraw, setCanDraw] = useState(false);

  // The scene waits until the page is idle, so compiling it never holds up a
  // first tap on the page's buttons.
  useEffect(() => {
    const start = () => setCanDraw(gpuAvailable());
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(start, { timeout: 2500 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(start, 600);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? true));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A reader who asks for reduced motion keeps the still poster: no GPU work at all.
  const showScene = hydrated && canDraw && !failed && !reduced;

  return (
    <div ref={box} aria-hidden="true" className={cn("relative isolate mx-auto aspect-square w-full max-w-xl", className)}>
      <div className={cn("absolute inset-0 grid place-items-center transition-opacity duration-1000", ready && showScene ? "opacity-0" : "opacity-100")}>
        <KnotMark className="absolute size-[86%] opacity-70 [&_g]:stroke-band-highlight [&_g]:[stroke-width:2.4]" />
        <div className="relative size-[34%] rounded-full p-1 ring-2 ring-band-highlight shadow-[0_0_80px_10px_rgb(var(--glow-gold)/0.35)]">
          <Image src={portrait} alt="" sizes="12rem" priority className="size-full rounded-full object-cover" />
        </div>
      </div>
      {showScene ? (
        <SceneBoundary onError={() => setFailed(true)}>
          <KnotScene portrait={portrait.src} running={inView} onReady={() => setReady(true)} />
        </SceneBoundary>
      ) : null}
    </div>
  );
}
