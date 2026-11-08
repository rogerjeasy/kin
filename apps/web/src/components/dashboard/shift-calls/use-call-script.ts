"use client";

import { useCallback, useState } from "react";

import { useShiftRequest } from "@/components/dashboard/shifts/use-shift-request";
import type { Locale } from "@/i18n/locales";
import type { SimulatedCall } from "@/server/shift-call-simulation";

/** Asks the server for what Kin would say on its call about a visit, built from the record. Asking again changes nothing. */
export function useCallScript(shiftId: string, locale: Locale) {
  const { send, pending, error } = useShiftRequest();
  const [call, setCall] = useState<SimulatedCall | null>(null);
  const load = useCallback(async () => {
    const reply = await send({ operation: "call_script", shiftId, locale });
    if (reply.ok && "call" in reply) setCall(reply.call);
  }, [send, shiftId, locale]);
  return { call, load, pending, error };
}
