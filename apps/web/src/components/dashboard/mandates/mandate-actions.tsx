"use client";

import { PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { useMandateRequest } from "./use-mandate-request";

type Props = {
  mandateId: string;
  canPause: boolean;
  canResume: boolean;
  canEnd: boolean;
  copy: Dictionary["dashboard"]["mandates"]["actions"];
  errors: Readonly<Record<string, string>>;
};

/** Pause, resume or end one standing permission. The server and the database decide who may. */
export function MandateActions({ mandateId, canPause, canResume, canEnd, copy, errors }: Props) {
  const { send, pending, error } = useMandateRequest();
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();

  async function act(operation: "pause" | "resume" | "revoke", said: string) {
    const reply = await send({ operation, mandateId });
    if (reply.ok) {
      setDone(said);
      router.refresh();
    }
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap gap-2">
        {canPause ? (
          <Button type="button" variant="outline" disabled={pending} className="min-h-11" onClick={() => act("pause", copy.paused)}>
            <PauseIcon aria-hidden="true" />
            {pending ? copy.working : copy.pause}
          </Button>
        ) : null}
        {canResume ? (
          <Button type="button" variant="outline" disabled={pending} className="min-h-11" onClick={() => act("resume", copy.resumed)}>
            <PlayIcon aria-hidden="true" />
            {pending ? copy.working : copy.resume}
          </Button>
        ) : null}
        {canEnd ? (
          <Button type="button" variant="outline" disabled={pending} className="min-h-11" onClick={() => act("revoke", copy.revoked)}>
            <XIcon aria-hidden="true" />
            {pending ? copy.working : copy.revoke}
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{errors[error] ?? errors["unavailable"]}</p> : null}
      {done && !error ? <p role="status" className="text-sm text-muted-foreground">{done}</p> : null}
    </div>
  );
}
