"use client";

import { PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { failureText, type ShiftCopy } from "@/content/circle/shift-words";
import type { PermissionCopy } from "@/content/circle/shift-permission-words";

import { useShiftRequest } from "./use-shift-request";

type Props = { permissionId: string; canPause: boolean; canResume: boolean; canEnd: boolean; copy: PermissionCopy["actions"]; shifts: ShiftCopy };

/** Pause, resume or end one standing permission. The server and the database decide who may. */
export function PermissionActions({ permissionId, canPause, canResume, canEnd, copy, shifts }: Props) {
  const { send, pending, error } = useShiftRequest();
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();

  async function act(operation: "pause_permission" | "resume_permission" | "revoke_permission", said: string) {
    const reply = await send({ operation, permissionId });
    if (reply.ok) {
      setDone(said);
      router.refresh();
    }
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap gap-2">
        {canPause ? (
          <Button type="button" variant="outline" disabled={pending} className="min-h-11" onClick={() => act("pause_permission", copy.paused)}>
            <PauseIcon aria-hidden="true" />
            {pending ? copy.working : copy.pause}
          </Button>
        ) : null}
        {canResume ? (
          <Button type="button" variant="outline" disabled={pending} className="min-h-11" onClick={() => act("resume_permission", copy.resumed)}>
            <PlayIcon aria-hidden="true" />
            {pending ? copy.working : copy.resume}
          </Button>
        ) : null}
        {canEnd ? (
          <Button type="button" variant="outline" disabled={pending} className="min-h-11" onClick={() => act("revoke_permission", copy.revoked)}>
            <XIcon aria-hidden="true" />
            {pending ? copy.working : copy.revoke}
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{failureText(shifts, error)}</p> : null}
      {done && !error ? <p role="status" className="text-sm text-muted-foreground">{done}</p> : null}
    </div>
  );
}
