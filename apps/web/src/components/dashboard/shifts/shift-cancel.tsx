"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { failureText, type ShiftCopy } from "@/content/circle/shift-words";

import { useShiftRequest } from "./use-shift-request";

/** Calling a shift off asks once first, since it cannot be undone. The server and the database decide who may. */
export function ShiftCancel({ shiftId, copy }: { shiftId: string; copy: ShiftCopy }) {
  const { send, pending, error } = useShiftRequest();
  const [asking, setAsking] = useState(false);
  const router = useRouter();
  const words = copy.actions;

  async function cancel() {
    const reply = await send({ operation: "cancel", shiftId });
    if (reply.ok) router.refresh();
    else setAsking(false);
  }

  return (
    <div className="min-w-0 space-y-2">
      {asking ? (
        <div role="group" aria-label={words.cancelAsk} className="flex flex-wrap items-center gap-2">
          <p className="w-full text-sm font-medium">{words.cancelAsk}</p>
          <Button type="button" variant="outline" disabled={pending} className="min-h-11" onClick={cancel}>
            {pending ? words.working : words.cancelYes}
          </Button>
          <Button type="button" variant="ghost" disabled={pending} className="min-h-11" onClick={() => setAsking(false)}>
            {words.cancelKeep}
          </Button>
        </div>
      ) : (
        <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(true)}>
          {words.cancel}
        </Button>
      )}
      {error ? <p role="alert" className="text-sm text-danger">{failureText(copy, error)}</p> : null}
    </div>
  );
}
