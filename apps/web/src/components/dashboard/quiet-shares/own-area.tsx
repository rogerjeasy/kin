"use client";

import { useState } from "react";

import type { AskView } from "@/server/quiet-shares";

import { MyPart } from "./my-part";
import { OfferComposer } from "./offer-composer";
import type { QuietScreen } from "./quiet-screen";
import { SealedOffer } from "./sealed-offer";
import { ShortfallOptions } from "./shortfall-options";

type Props = { screen: QuietScreen; ask: AskView };

/**
 * What one person does with one ask, from where it stands: talk to their own
 * Kin and seal an offer, see it sealed while the others answer, help close a
 * gap, then see and accept their own part. Someone who does not share the
 * cost sees only the family's progress, which the card above them shows.
 */
export function OwnArea({ screen, ask }: Props) {
  const [changing, setChanging] = useState(false);
  const answering = ask.iAmAsked && screen.mayOffer;

  if (ask.state === "withdrawn") return <p className="text-sm text-muted-foreground">{screen.copy.withdrawn}</p>;
  if (!answering) {
    return ask.state === "short" ? <ShortfallOptions screen={screen} ask={ask} /> : <p className="text-sm text-muted-foreground">{screen.copy.readOnly}</p>;
  }
  if (ask.offersOpen && (ask.myOffer === null || changing)) {
    return <OfferComposer screen={screen} ask={ask} onDone={ask.myOffer === null ? undefined : () => setChanging(false)} />;
  }
  return (
    <div className="grid min-w-0 gap-4">
      {ask.state === "short" ? <ShortfallOptions screen={screen} ask={ask} /> : null}
      {ask.myPart !== null && (ask.state === "planned" || ask.state === "agreed") ? <MyPart screen={screen} ask={ask} /> : null}
      {ask.myOffer !== null && ask.offersOpen ? (
        <>
          <SealedOffer screen={screen} offer={ask.myOffer} sealsLeft={ask.sealsLeft} canChange={ask.offersOpen} onChange={() => setChanging(true)} />
          {ask.state === "gathering" ? <p className="text-sm text-muted-foreground">{screen.copy.offer.waiting}</p> : null}
        </>
      ) : null}
    </div>
  );
}
