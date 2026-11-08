"use client";

import { useRouter } from "next/navigation";

import { useShiftRequest } from "@/components/dashboard/shifts/use-shift-request";
import { failureText, type ShiftCopy } from "@/content/circle/shift-words";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";

import { CallSimulator } from "./call-simulator";

type Props = { shiftId: string; locale: Locale; parent: string; copy: Dictionary["dashboard"]["shiftCalls"]["simulator"]; shifts: ShiftCopy };

/** The simulator on a shift card: a yes records the family's word as the confirm button would, then the screen reads again. */
export function ShiftCallButton({ shiftId, locale, parent, copy, shifts }: Props) {
  const { send, error } = useShiftRequest();
  const router = useRouter();
  async function yes(): Promise<boolean> {
    const reply = await send({ operation: "confirm", shiftId });
    if (reply.ok) router.refresh();
    return reply.ok;
  }
  return (
    <div className="min-w-0 space-y-2">
      <CallSimulator shiftId={shiftId} locale={locale} parent={parent} copy={copy} shifts={shifts} onYes={yes} />
      {error ? <p role="alert" className="text-sm text-danger">{failureText(shifts, error)}</p> : null}
    </div>
  );
}
