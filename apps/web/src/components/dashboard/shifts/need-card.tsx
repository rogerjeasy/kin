"use client";

import { CheckCircle2Icon, LogInIcon, LogOutIcon, MessageCircleQuestionIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { CallSimulator } from "@/components/dashboard/shift-calls/call-simulator";
import { Button } from "@/components/ui/button";
import { failureText, turnWords, type ShiftCopy, type TurnWords } from "@/content/circle/shift-words";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import type { Formatters } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useShiftRequest } from "./use-shift-request";

/** One thing the viewer is asked for, with every word already in their language. */
export type NeedItem = {
  readonly shiftId: string;
  readonly kind: "check_in" | "check_out" | "word";
  /** The big line: the question to the family, or the shift the caregiver is on. */
  readonly headline: string;
  readonly when: string;
  readonly hint: string;
  readonly buttonLabel: string;
  /** The caregiver the shift is for, the wallet their pay goes to, and whether the viewer is them. */
  readonly name: string;
  readonly wallet: "paypal" | "venmo";
  readonly toYou: boolean;
  /** Who worded the headline, when the model had a go at it: a provenance badge, drawn by the server. */
  readonly badge?: ReactNode;
  /** A demo circle can play Kin's call about this visit, since the family's word is asked for. */
  readonly callSim?: boolean;
};

export type NeedAnswer = { readonly kind: NeedItem["kind"]; readonly words: TurnWords };

type Props = {
  item: NeedItem;
  answer: NeedAnswer | null;
  copy: ShiftCopy;
  format: Formatters;
  parent: string;
  approvalsHref: string;
  locale: Locale;
  calls: Dictionary["dashboard"]["shiftCalls"];
  onAnswer: (answer: NeedAnswer) => void;
};

const OPERATION = { check_in: "check_in", check_out: "check_out", word: "confirm" } as const;
const ICON = { check_in: LogInIcon, check_out: LogOutIcon, word: MessageCircleQuestionIcon } as const;

/**
 * A big, plain card for the one thing asked now: tap in, tap out, or say that
 * the visit happened. It says what came of the tap in words, and stays on the
 * screen to say so after the shift has moved on.
 */
export function NeedCard({ item, answer, copy, format, parent, approvalsHref, locale, calls, onAnswer }: Props) {
  const { send, pending, error } = useShiftRequest();
  const router = useRouter();
  const Icon = ICON[item.kind];
  const answered = answer !== null && answer.kind === item.kind ? answer : null;

  /** Sends the tap or the word, and says what came of it. `false` when it was refused. */
  async function turn(): Promise<boolean> {
    const reply = await send({ operation: OPERATION[item.kind], shiftId: item.shiftId });
    if (!reply.ok) return false;
    const who = { format, parent, name: item.name, wallet: item.wallet, toYou: item.toYou };
    const words: TurnWords =
      "outcome" in reply
        ? turnWords(copy, item.kind === "check_out" ? "check_out" : "confirm", reply.outcome, who)
        : { text: copy.outcome.checkedIn, detail: null, toApprovals: false };
    onAnswer({ kind: item.kind, words });
    router.refresh();
    return true;
  }

  return (
    <li id={`need-${item.shiftId}`} className={cn("min-w-0 space-y-4 rounded-2xl border-2 p-5 shadow-xs sm:p-6", answered ? "border-positive/40 bg-positive/5" : "border-highlight/50 bg-highlight/5")}>
      {answered ? (
        <div role="status" className="flex min-w-0 items-start gap-3">
          <CheckCircle2Icon aria-hidden="true" className="mt-1 size-7 shrink-0 text-positive" />
          <div className="min-w-0 space-y-2">
            <p className="text-lg font-semibold text-pretty">{answered.words.text}</p>
            {answered.words.detail ? <p className="text-pretty text-muted-foreground">{answered.words.detail}</p> : null}
            {answered.words.toApprovals ? (
              <Link href={approvalsHref} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
                {copy.outcome.approvals}
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="flex min-w-0 items-start gap-3">
            <Icon aria-hidden="true" className="mt-1.5 size-7 shrink-0 text-highlight" />
            <div className="min-w-0">
              <h3 className="font-serif text-2xl leading-snug text-balance sm:text-3xl">{item.headline}</h3>
              <p className="mt-1 text-base text-muted-foreground">{item.when}</p>
              {item.badge ? <div className="mt-2">{item.badge}</div> : null}
            </div>
          </div>
          <p className="text-base text-pretty">{item.hint}</p>
          <Button type="button" disabled={pending} onClick={() => void turn()} className="h-auto min-h-14 w-full whitespace-normal px-6 py-3 text-lg sm:w-auto">
            {pending ? copy.needs.working : item.buttonLabel}
          </Button>
          {item.callSim ? <CallSimulator shiftId={item.shiftId} locale={locale} parent={parent} copy={calls.simulator} shifts={copy} onYes={turn} large /> : null}
          {error ? <p role="alert" className="text-base text-danger">{failureText(copy, error)}</p> : null}
        </>
      )}
    </li>
  );
}
