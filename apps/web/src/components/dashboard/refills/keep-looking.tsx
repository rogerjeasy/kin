"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Reads the screen again every `seconds`, for as long as it is mounted: an order on its way changes while the family watches. */
export function KeepLooking({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
