"use client";

import type { DraftedWish } from "@kin/agent";
import { CheckIcon, CircleAlertIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { wishReadBack, type WishNameBook } from "@/components/dashboard/words/wish-words";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { formatters } from "@/lib/format";

import { useWishRequest } from "./use-wish-request";

type Props = {
  readonly copy: Dictionary["dashboard"]["wishes"];
  readonly drafts: readonly DraftedWish[];
  readonly book: WishNameBook;
  readonly locale: Locale;
  readonly currency: string;
  readonly timezone: string;
  readonly recordingId: string | null;
  readonly wishKey: string | null;
};

/**
 * Kin's read-back of what she said: each wish as the rule Kin would keep, in
 * Kin's fixed words, for her to confirm or leave out. A wish Kin cannot make
 * into a rule is said so, and nothing is kept for it.
 */
export function DraftReadBack({ copy, drafts, book, locale, currency, timezone, recordingId, wishKey }: Props) {
  const format = useMemo(() => formatters(locale, currency, timezone), [locale, currency, timezone]);
  const { send, pending, error } = useWishRequest();
  const [answered, setAnswered] = useState<Readonly<Record<number, "kept" | "left">>>({});
  const record = copy.record;

  async function keep(index: number, draft: Extract<DraftedWish, { kind: "draft" }>["draft"]) {
    const reply = await send({ operation: "keep", quote: draft.quote, trigger: draft.trigger, rule: draft.rule, recordingId, wishKey, method: "app" });
    if (reply.ok) setAnswered((before) => ({ ...before, [index]: "kept" }));
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h3 className="text-xl font-semibold">{record.readBackTitle}</h3>
      {drafts.length === 0 ? <p className="text-lg text-pretty">{copy.reasons.unreadable}</p> : null}
      <ol className="flex min-w-0 flex-col gap-4">
        {drafts.map((drafted, index) => {
          const done = answered[index];
          if (drafted.kind === "flagged") {
            return (
              <li key={index} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-dashed p-5">
                <p dir="auto" className="text-xl text-pretty break-words">“{drafted.quote}”</p>
                <p className="flex items-start gap-2 text-lg text-pretty">
                  <CircleAlertIcon aria-hidden="true" className="mt-1 size-5 shrink-0 text-highlight" />
                  <span className="min-w-0">
                    {record.flagged} <span className="text-muted-foreground">{record.flagReasons[drafted.reason]}</span>
                  </span>
                </p>
              </li>
            );
          }
          const { when, does } = wishReadBack(copy, book, format, drafted.draft, "you");
          return (
            <li key={index} className="flex min-w-0 flex-col gap-4 rounded-2xl border bg-secondary/30 p-5">
              <p dir="auto" className="text-2xl font-semibold text-pretty break-words">“{drafted.draft.quote}”</p>
              <p className="text-xl text-pretty">
                <span className="font-semibold">{when}: </span>
                {does}
              </p>
              {done === "kept" ? (
                <p role="status" className="flex items-center gap-2 text-lg font-semibold text-positive">
                  <CheckIcon aria-hidden="true" className="size-6" />
                  {record.kept}
                </p>
              ) : done === "left" ? null : (
                <div className="flex min-w-0 flex-wrap gap-3">
                  <Button type="button" disabled={pending} onClick={() => keep(index, drafted.draft)} className="h-auto min-h-16 w-full max-w-full px-6 text-xl whitespace-normal sm:w-auto">
                    <CheckIcon aria-hidden="true" className="size-6" />
                    {record.keep}
                  </Button>
                  <Button type="button" variant="outline" disabled={pending} onClick={() => setAnswered((before) => ({ ...before, [index]: "left" }))} className="h-auto min-h-16 w-full max-w-full px-6 text-xl whitespace-normal sm:w-auto">
                    <XIcon aria-hidden="true" className="size-6" />
                    {record.notThis}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {error ? (
        <p role="alert" className="text-lg text-danger">
          {copy.reasons[error]}
        </p>
      ) : null}
    </div>
  );
}
