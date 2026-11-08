"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Collects what changed (a sort, a filter, a grouping) and says it once,
 * after a short pause, so a screen reader hears one sentence for a burst of
 * changes instead of one for each keystroke. Render `message` in a live region.
 */
export function useAnnouncer(delayMs = 400) {
  const [message, setMessage] = useState("");
  const pending = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const announce = useCallback(
    (text: string) => {
      pending.current = [...pending.current.filter((each) => each !== text), text];
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setMessage(pending.current.join(" "));
        pending.current = [];
      }, delayMs);
    },
    [delayMs],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  return { message, announce };
}
