"use client";

import type { QuietPartMethod } from "@kin/domain";
import { CheckIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatters } from "@/lib/format";
import type { AskView } from "@/server/quiet-shares";

import { PartAction } from "./part-action";
import { PartFigures } from "./part-figures";
import type { QuietScreen } from "./quiet-screen";
import { useQuietShare } from "./use-quiet-share";

type Props = { screen: QuietScreen; ask: AskView };

/**
 * The person's own part of the plan. While the plan waits they choose how
 * they will pay and say yes to their part; once everyone has, the PayPal step
 * for their part is ready. Nothing here is anyone else's.
 */
export function MyPart({ screen, ask }: Props) {
  const { copy } = screen;
  const words = copy.part;
  const id = useId();
  const format = formatters(screen.locale, screen.currency, screen.timezone);
  const [method, setMethod] = useState<QuietPartMethod>(ask.methods[0] ?? "checkout");
  const { send, pending, error } = useQuietShare(screen.seat);
  const part = ask.myPart;
  if (part === null) return null;
  const waitingForMe = ask.state === "planned" && part.acceptedAt === null;

  return (
    <div className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
      <PartFigures copy={copy} part={part} costCents={ask.costCents} startMonth={ask.startMonth} format={format} />
      {waitingForMe ? (
        <form
          className="min-w-0 space-y-3 border-t pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void send({ operation: "accept", askId: ask.id, method });
          }}
        >
          {ask.methods.length > 1 && part.cents > 0 ? (
            <fieldset className="min-w-0 space-y-2">
              <legend className="font-medium">{words.methodLabel}</legend>
              {ask.methods.map((each) => (
                <label key={each} htmlFor={`${id}-${each}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 has-[:checked]:border-primary">
                  <input id={`${id}-${each}`} type="radio" name={`${id}-method`} value={each} checked={method === each} onChange={() => setMethod(each)} className="size-5 shrink-0 accent-primary" />
                  <span className="min-w-0">{words.methods[each]}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <Button type="submit" disabled={pending} className="h-auto min-h-12 max-w-full whitespace-normal">
            <CheckIcon aria-hidden="true" />
            {pending ? words.accepting : words.accept}
          </Button>
          {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error]}</p> : null}
        </form>
      ) : null}
      {ask.state === "planned" && part.acceptedAt !== null ? (
        <p role="status" className="flex items-center gap-2 border-t pt-4 text-sm font-medium">
          <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-positive" />
          {words.accepted}
        </p>
      ) : null}
      {ask.state === "agreed" ? <PartAction screen={screen} ask={ask} part={part} /> : null}
    </div>
  );
}
