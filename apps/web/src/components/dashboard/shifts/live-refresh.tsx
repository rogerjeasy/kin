"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const REFRESH_MS = 5_000;
/** A tab left open stops asking after this long, so it cannot ask forever; coming back to it asks at once. */
const GIVE_UP_MS = 10 * 60_000;

/**
 * Asks the server for the screen again every few seconds while something on
 * it can still change by itself (a visit under way, a payment on its way), so
 * a caregiver sees "paid" arrive without reloading. It asks only while the tab
 * is visible, stops when nothing is pending, and cleans up when the screen
 * goes away. It renders nothing.
 */
export function LiveRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let started = Date.now();
    const look = () => {
      if (document.visibilityState === "visible" && Date.now() - started < GIVE_UP_MS) router.refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        started = Date.now();
        router.refresh();
      }
    };
    const timer = window.setInterval(look, REFRESH_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, router]);
  return null;
}
