"use client";

import { CheckCircle2Icon, ShieldAlertIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { numberLocaleOf, type Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import type { PublicPresence } from "@/server/presence-link";
import { formatMoney } from "@kin/domain";

type Props = { token: string; status: PublicPresence; copy: Dictionary["presenceLink"]; locale: Locale };
type Outcome = "me" | "not_me" | { readonly problem: keyof Dictionary["presenceLink"]["problems"] };

const KEY_CLASS = "h-auto min-h-20 w-full flex-col gap-1 whitespace-normal px-6 py-4 text-2xl";

async function answer(token: string, choice: "me" | "not_me"): Promise<Outcome> {
  try {
    const response = await fetch("/api/presence-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, answer: choice }) });
    if (response.ok) return choice;
    const body = (await response.json()) as { reason?: string };
    return { problem: body.reason === "busy" || body.reason === "state" || body.reason === "link" ? body.reason : "unavailable" };
  } catch {
    return { problem: "unavailable" };
  }
}

/**
 * The question and its two big answers. The server read the check without
 * changing anything; the database decides on the tap, so a late or repeated
 * answer is refused or ignored there and this page only says what happened.
 * A "no" is told plainly: the family has been told and money is held.
 */
export function PresenceCard({ token, status, copy, locale }: Props) {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const amount = status.claimedCents === null ? null : formatMoney({ cents: status.claimedCents, currency: status.currency }, numberLocaleOf(locale));
  const slots = { parent: status.parentFirstName, amount: amount ?? "" };

  async function tap(choice: "me" | "not_me") {
    setPending(true);
    setOutcome(await answer(token, choice));
    setPending(false);
  }

  if (outcome === "me" || outcome === "not_me") {
    const Icon = outcome === "me" ? CheckCircle2Icon : ShieldAlertIcon;
    return (
      <p role="status" className="flex min-w-0 items-start gap-3 text-xl font-semibold text-pretty">
        <Icon aria-hidden="true" className="mt-1 size-7 shrink-0" />
        <span className="min-w-0">{fill(outcome === "me" ? copy.thanksYes : copy.thanksNo, slots)}</span>
      </p>
    );
  }

  return (
    <div className="min-w-0 space-y-6" aria-busy={pending}>
      <p className="text-xl font-semibold text-pretty">{amount === null ? fill(copy.questionNoAmount, slots) : fill(copy.question, slots)}</p>
      {status.canAnswer ? (
        <div className="grid min-w-0 gap-3">
          <Button type="button" disabled={pending} onClick={() => void tap("me")} className={KEY_CLASS}>
            {pending ? copy.working : copy.yes}
            <span className="text-base font-normal">{copy.yesHint}</span>
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => void tap("not_me")} className={KEY_CLASS}>
            {pending ? copy.working : copy.no}
            <span className="text-base font-normal">{copy.noHint}</span>
          </Button>
        </div>
      ) : (
        <p className="text-base text-muted-foreground text-pretty">{fill(copy.closed, slots)}</p>
      )}
      {status.simulated ? <p className="text-sm text-muted-foreground">{copy.demo}</p> : null}
      {outcome !== null && "problem" in outcome ? (
        <p role="alert" className="flex min-w-0 items-start gap-3 text-xl font-medium text-pretty text-danger">
          <TriangleAlertIcon aria-hidden="true" className="mt-1 size-7 shrink-0" />
          <span className="min-w-0">{copy.problems[outcome.problem]}</span>
        </p>
      ) : null}
    </div>
  );
}
