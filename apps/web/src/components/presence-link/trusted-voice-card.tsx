"use client";

import { CheckCircle2Icon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";

import { inputClass } from "@/components/dashboard/create-circle/field";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

type Props = { token: string; name: string; parentFirstName: string; copy: Dictionary["trustedVoiceLink"] };
type Outcome = { readonly done: true } | { readonly problem: keyof Dictionary["trustedVoiceLink"]["problems"] };

async function confirm(token: string, receiver: string): Promise<Outcome> {
  try {
    const response = await fetch("/api/trusted-voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(receiver.trim() === "" ? { token } : { token, receiver: receiver.trim() }) });
    if (response.ok) return { done: true };
    const body = (await response.json()) as { reason?: string };
    return { problem: body.reason === "busy" || body.reason === "link" ? body.reason : "unavailable" };
  } catch {
    return { problem: "unavailable" };
  }
}

/** One big key: "yes, this is my number". Only the database says whether the link still counts. */
export function TrustedVoiceCard({ token, name, parentFirstName, copy }: Props) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [receiver, setReceiver] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (outcome !== null && "done" in outcome) {
    return (
      <p role="status" className="flex min-w-0 items-start gap-3 text-xl font-semibold text-pretty text-positive">
        <CheckCircle2Icon aria-hidden="true" className="mt-1 size-7 shrink-0" />
        <span className="min-w-0">{fill(copy.done, { name })}</span>
      </p>
    );
  }

  return (
    <div className="min-w-0 space-y-6" aria-busy={pending}>
      <p className="text-base text-pretty">{copy.body}</p>
      <p className="sr-only">{parentFirstName}</p>
      <div className="min-w-0 space-y-1">
        <label htmlFor={`${id}-account`} className="text-lg font-medium">{copy.accountLabel}</label>
        <p id={`${id}-account-hint`} className="text-sm text-muted-foreground text-pretty">{copy.accountHint}</p>
        <input id={`${id}-account`} aria-describedby={`${id}-account-hint`} type="email" inputMode="email" dir="ltr" autoComplete="email" maxLength={127} value={receiver} disabled={pending} onChange={(event) => setReceiver(event.target.value)} className={inputClass} />
      </div>
      <Button
        type="button"
        disabled={pending}
        onClick={() => {
          setPending(true);
          void confirm(token, receiver).then((result) => {
            setOutcome(result);
            setPending(false);
          });
        }}
        className="h-auto min-h-20 w-full whitespace-normal px-6 py-4 text-2xl"
      >
        {pending ? copy.working : copy.confirm}
      </Button>
      {outcome !== null && "problem" in outcome ? (
        <p role="alert" className="flex min-w-0 items-start gap-3 text-xl font-medium text-pretty text-danger">
          <TriangleAlertIcon aria-hidden="true" className="mt-1 size-7 shrink-0" />
          <span className="min-w-0">{copy.problems[outcome.problem]}</span>
        </p>
      ) : null}
    </div>
  );
}
