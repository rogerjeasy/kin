"use client";

import { CheckCircle2Icon, LogInIcon, LogOutIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import type { CheckLinkProblem, PublicCheck, PublicStatus } from "@/server/check-link";

import { CheckResult, plannedWords } from "./check-result";
import { tapLink } from "./tap-link";

type Props = { token: string; status: PublicStatus; copy: Dictionary["checkLink"]; locale: Locale };
type Outcome = { readonly check: PublicCheck } | { readonly problem: CheckLinkProblem };

const KEY_CLASS = "h-auto min-h-20 w-full flex-col gap-1 whitespace-normal px-6 py-4 text-2xl";

/**
 * Who the visit is for, when it is planned, and the one big key that fits where
 * it is: Check in before the visit, Check out during it, and a thank-you once
 * both have turned. The server read the status without turning anything, so no
 * wrong key is ever offered; the database still decides on the tap.
 */
export function CheckCard({ token, status, copy, locale }: Props) {
  const [next, setNext] = useState(status.next);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const told = outcome !== null && "check" in outcome;

  async function tap(action: "in" | "out") {
    setPending(true);
    const reply = await tapLink(token, action);
    setOutcome(reply.ok ? { check: reply.check } : { problem: reply.reason });
    if (reply.ok) setNext(action === "in" ? "out" : "done");
    setPending(false);
  }

  return (
    <div className="min-w-0 space-y-6" aria-busy={pending}>
      {told ? null : (
        <div className="min-w-0 space-y-1">
          <p className="text-xl font-semibold text-pretty">{fill(copy.hello, { name: status.name })}</p>
          <p className="text-base text-muted-foreground text-pretty">{plannedWords(copy, locale, status)}</p>
        </div>
      )}
      {next === "in" ? (
        <Button type="button" disabled={pending} onClick={() => void tap("in")} className={KEY_CLASS}>
          <LogInIcon aria-hidden="true" className="size-8 rtl:-scale-x-100" />
          {pending ? copy.working : copy.checkIn}
          <span className="text-base font-normal">{copy.checkInHint}</span>
        </Button>
      ) : null}
      {next === "out" ? (
        <Button type="button" disabled={pending} onClick={() => void tap("out")} className={KEY_CLASS}>
          <LogOutIcon aria-hidden="true" className="size-8 rtl:-scale-x-100" />
          {pending ? copy.working : copy.checkOut}
          <span className="text-base font-normal">{copy.checkOutHint}</span>
        </Button>
      ) : null}
      {next === "done" && !told ? (
        <p role="status" className="flex min-w-0 items-start gap-3 text-xl font-semibold text-pretty text-positive">
          <CheckCircle2Icon aria-hidden="true" className="mt-1 size-7 shrink-0" />
          <span className="min-w-0">{fill(copy.done, { name: status.name })}</span>
        </p>
      ) : null}
      {outcome ? <CheckResult copy={copy} locale={locale} outcome={outcome} /> : null}
    </div>
  );
}
