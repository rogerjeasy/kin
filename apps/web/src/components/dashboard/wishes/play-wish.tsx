"use client";

import { AudioLinesIcon, PlayIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type Copy = { readonly label: string; readonly voice: string; readonly playing: string; readonly stop: string; readonly unavailable: string };
type Props = { readonly wishId: string; readonly locale: string; readonly copy: Copy; readonly size?: "default" | "large" };

/**
 * Her words, one tap away: her own recording when she made one, or her stored
 * words read by Kin's voice. The label always says which, so a synthetic voice
 * is never taken for hers.
 */
export function PlayWish({ wishId, locale, copy, size = "default" }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "failed">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);

  useEffect(
    () => () => {
      audio.current?.pause();
      if (url.current !== null) URL.revokeObjectURL(url.current);
    },
    [],
  );

  function stop() {
    audio.current?.pause();
    setState("idle");
  }

  async function play() {
    setState("loading");
    try {
      if (url.current === null) {
        const response = await fetch("/api/wishes/audio", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wishId, locale }) });
        const type = response.headers.get("content-type") ?? "";
        if (!response.ok || !type.startsWith("audio/")) throw new Error("no audio");
        url.current = URL.createObjectURL(await response.blob());
      }
      const player = new Audio(url.current);
      audio.current = player;
      player.onended = () => setState("idle");
      player.onerror = () => setState("failed");
      await player.play();
      setState("playing");
    } catch {
      setState("failed");
    }
  }

  const large = size === "large";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        {state === "playing" ? (
          <Button type="button" variant="outline" onClick={stop} className={large ? "h-auto min-h-14 px-5 text-lg" : "h-auto min-h-11"}>
            <SquareIcon aria-hidden="true" />
            {copy.stop}
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={play} disabled={state === "loading"} aria-describedby={`${wishId}-voice`} className={large ? "h-auto min-h-14 max-w-full px-5 text-start text-lg whitespace-normal" : "h-auto min-h-11 max-w-full text-start whitespace-normal"}>
            <PlayIcon aria-hidden="true" />
            {copy.label}
          </Button>
        )}
        {state === "playing" ? (
          <span role="status" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <AudioLinesIcon aria-hidden="true" className="size-4 motion-safe:animate-pulse" />
            {copy.playing}
          </span>
        ) : null}
      </div>
      <p id={`${wishId}-voice`} className="text-xs text-muted-foreground">
        {copy.voice}
      </p>
      {state === "failed" ? (
        <p role="alert" className="text-sm text-danger">
          {copy.unavailable}
        </p>
      ) : null}
    </div>
  );
}
