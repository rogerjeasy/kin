"use client";

import { decimalAmount } from "@kin/domain";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { AskView, DraftForm } from "@/server/quiet-shares";

import { OfferForm } from "./offer-form";
import { PrivateChat } from "./private-chat";
import type { QuietScreen } from "./quiet-screen";

type Props = { screen: QuietScreen; ask: AskView; onDone?: () => void };

const EMPTY: DraftForm = { monthly: "", stepUp: "", stepUpMonth: "", earliestMonth: "", careTrips: "", careHours: "" };

/** The person's offer as the form starts it: their sealed one, when they are changing it, or nothing yet. */
function startingDraft(ask: AskView, currency: string): DraftForm {
  const offer = ask.myOffer;
  if (offer === null) return EMPTY;
  return {
    monthly: offer.monthlyCents === 0 ? "" : decimalAmount({ cents: offer.monthlyCents, currency }),
    stepUp: offer.stepUp === null ? "" : decimalAmount({ cents: offer.stepUp.cents, currency }),
    stepUpMonth: offer.stepUp?.fromMonth ?? "",
    earliestMonth: offer.earliestMonth ?? "",
    careTrips: offer.careTrips === 0 ? "" : String(offer.careTrips),
    careHours: offer.careMinutes === 0 ? "" : decimalAmount({ cents: Math.round((offer.careMinutes * 100) / 60), currency: "USD" }).replace(/\.00$/u, ""),
  };
}

/**
 * Thinking aloud with one's own Kin, then sealing the offer: the private
 * conversation fills the form, and the person checks it and seals it. Each
 * new draft from Kin replaces the form's figures, which the person can still
 * change before sealing.
 */
export function OfferComposer({ screen, ask, onDone }: Props) {
  const [draft, setDraft] = useState<DraftForm>(() => startingDraft(ask, screen.currency));
  const [version, setVersion] = useState(0);
  return (
    <div className="@container min-w-0">
      <div className="grid min-w-0 items-start gap-4 @3xl:grid-cols-2">
      <PrivateChat
        screen={screen}
        askId={ask.id}
        title={ask.title}
        examples={ask.simulated}
        onDraft={(next) => {
          setDraft(next);
          setVersion((count) => count + 1);
        }}
      />
      <OfferForm
        key={version}
        screen={screen}
        askId={ask.id}
        startMonth={ask.startMonth}
        sealsLeft={ask.sealsLeft}
        draft={draft}
        onChange={setDraft}
        onSealed={() => onDone?.()}
        aside={
          onDone && ask.myOffer !== null ? (
            <Button type="button" variant="ghost" className="min-h-11" onClick={onDone}>
              {screen.copy.offer.cancel}
            </Button>
          ) : null
        }
      />
      </div>
    </div>
  );
}
