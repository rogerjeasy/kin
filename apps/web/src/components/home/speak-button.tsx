"use client";

import { PlayIcon, SquareIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useHydrated } from "@/lib/use-hydrated";

type SpeakButtonProps = {
  /** The sentence to say. */
  text: string;
  /** Its language, so the browser picks a matching voice. */
  lang: string;
  playLabel: string;
  stopLabel: string;
};

/**
 * Says a sentence aloud with the browser's own voice. The product uses a
 * speech service. This is a preview, and it disappears where the browser has
 * no voice.
 */
export function SpeakButton({ text, lang, playLabel, stopLabel }: SpeakButtonProps) {
  // Assume a voice until the browser says otherwise, so the button does not pop in.
  const unsupported = useHydrated() && !("speechSynthesis" in window);
  const [speaking, setSpeaking] = useState(false);

  // Leaving the page must not leave a voice talking.
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  if (unsupported) {
    return null;
  }

  function toggle() {
    window.speechSynthesis.cancel();
    if (speaking) {
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={speaking ? stopLabel : playLabel}
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-300 hover:scale-105 active:scale-95 motion-safe:animate-glow-pulse"
    >
      {speaking ? <SquareIcon className="size-3.5 fill-current" /> : <PlayIcon className="ml-0.5 size-4 fill-current" />}
    </button>
  );
}
