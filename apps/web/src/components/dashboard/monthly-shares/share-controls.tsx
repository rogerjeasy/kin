"use client";

import { centsFromDecimal, checkMonthlyShare } from "@kin/domain";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Button, buttonVariants } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import { cn } from "@/lib/utils";

import { useShareRequest } from "./use-share-request";

type Props = {
  copy: Dictionary["dashboard"]["monthly"];
  currency: string;
  limits: { min: string; max: string };
  /** The viewer's own live share, or `null` when they have none. */
  share: { state: "approval_pending" | "active" | "paused"; approvalUrl: string | null } | null;
  demo: boolean;
  /** The member has just come back from PayPal: read the share back at once. */
  checkOnLoad: boolean;
};

/** The viewer's own monthly share: start it, send them to approve it, pause, resume or end it. */
export function ShareControls({ copy, currency, limits, share, demo, checkOnLoad }: Props) {
  const { send, pending, error } = useShareRequest();
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [amountError, setAmountError] = useState(false);
  const checked = useRef(false);

  // Back from PayPal: ask once, then show what PayPal said.
  useEffect(() => {
    if (!checkOnLoad || checked.current || share?.state !== "approval_pending") return;
    checked.current = true;
    void send({ operation: "check" }).then((answer) => {
      if (answer.ok) router.refresh();
    });
  }, [checkOnLoad, router, send, share?.state]);

  async function run(input: Record<string, string>, message: string | null) {
    setNotice(null);
    const answer = await send(input);
    if (!answer.ok) return;
    setNotice(message);
    router.refresh();
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAmountError(false);
    const text = String(new FormData(event.currentTarget).get("amount") ?? "").trim();
    if (!validAmount(text, currency)) {
      setAmountError(true);
      return;
    }
    setNotice(null);
    const answer = await send({ operation: "start", amount: text });
    if (!answer.ok) return;
    // A real share goes on to PayPal's page to be approved; a demo share is already running.
    if (answer.approvalUrl !== null) window.location.assign(answer.approvalUrl);
    else {
      setNotice(copy.started);
      router.refresh();
    }
  }

  return (
    <div className="grid min-w-0 gap-4 rounded-xl border p-4">
      <h3 className="font-semibold">{copy.yours}</h3>
      {share === null ? (
        <form onSubmit={start} className="grid min-w-0 gap-4" noValidate>
          <fieldset disabled={pending} className="grid min-w-0 gap-4">
            <Field id="monthly-amount" label={copy.amount} hint={fill(copy.amountHint, limits)}>
              <input id="monthly-amount" name="amount" type="text" inputMode="decimal" required maxLength={12} aria-describedby="monthly-amount-hint" aria-invalid={amountError} className={inputClass} />
            </Field>
          </fieldset>
          <Button type="submit" disabled={pending} className="min-h-11 justify-self-start">
            {pending ? copy.starting : copy.start}
          </Button>
        </form>
      ) : (
        <div className="grid min-w-0 gap-4">
          {share.state === "approval_pending" ? (
            <>
              <p className="text-sm text-pretty text-muted-foreground">{copy.approveText}</p>
              <div className="flex flex-wrap gap-3">
                {share.approvalUrl === null ? null : (
                  <a href={share.approvalUrl} className={cn(buttonVariants({ size: "sm" }))}>
                    {copy.approve}
                  </a>
                )}
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void run({ operation: "check" }, copy.changed)}>
                  {pending ? copy.checking : copy.check}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void run({ operation: "cancel" }, copy.changed)}>
                  {copy.cancel}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-3">
              {share.state === "active" ? (
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void run({ operation: "pause" }, copy.changed)}>
                  {pending ? copy.working : copy.pause}
                </Button>
              ) : (
                <Button type="button" size="sm" disabled={pending} onClick={() => void run({ operation: "resume" }, copy.changed)}>
                  {pending ? copy.working : copy.resume}
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void run({ operation: "cancel" }, copy.changed)}>
                {copy.cancel}
              </Button>
            </div>
          )}
        </div>
      )}
      {demo ? <p className="text-sm text-pretty text-muted-foreground">{copy.demoNote}</p> : null}
      {amountError ? (
        <p role="alert" className="text-sm text-danger">
          {copy.errors.amount}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {copy.errors[error]}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-positive">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

/** Whether the text is an amount a member may commit to every month; the server checks it again. */
function validAmount(text: string, currency: string): boolean {
  try {
    return checkMonthlyShare({ cents: centsFromDecimal(text, currency), currency }).ok;
  } catch {
    return false;
  }
}
