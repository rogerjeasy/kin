"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => undefined;

/**
 * False while rendering on the server and during hydration, true afterwards.
 * For the few things only the browser knows, such as the real address of a
 * prerendered page or whether the browser has a voice.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
