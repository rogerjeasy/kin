"use client";

import { CheckIcon, PenLineIcon, UndoIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { useWishRequest } from "./use-wish-request";

type Copy = Dictionary["dashboard"]["wishes"];
type Props = {
  readonly wishId: string;
  readonly copy: Copy;
  readonly can: { readonly witness: boolean; readonly withdraw: boolean; readonly change: string | null };
  readonly witnessHint: string;
  readonly large?: boolean;
};

/** What the viewer may do with one wish: witness it, or, as the parent, withdraw it or say it differently. The database decides again. */
export function WishActions({ wishId, copy, can, witnessHint, large = false }: Props) {
  const { send, pending, error } = useWishRequest();
  const [confirming, setConfirming] = useState(false);
  const button = large ? "h-auto min-h-14 px-5 text-lg" : "h-auto min-h-11";
  if (!can.witness && !can.withdraw && can.change === null) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {can.witness ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <Button type="button" className={`${button} w-full sm:w-auto`} disabled={pending} onClick={() => send({ operation: "witness", wishId })}>
            <CheckIcon aria-hidden="true" />
            {copy.actions.witness}
          </Button>
          <p className="text-xs text-muted-foreground">{witnessHint}</p>
        </div>
      ) : null}
      {confirming ? (
        <div role="group" aria-label={copy.actions.withdraw} className="flex min-w-0 flex-col gap-2 rounded-xl border bg-secondary/40 p-3">
          <p className="text-pretty">{copy.actions.withdrawConfirm}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className={`${button} border-danger text-danger hover:bg-danger/10`} disabled={pending} onClick={() => send({ operation: "withdraw", wishId })}>
              {copy.actions.withdrawYes}
            </Button>
            <Button type="button" variant="outline" className={button} onClick={() => setConfirming(false)}>
              {copy.actions.keepIt}
            </Button>
          </div>
        </div>
      ) : can.withdraw || can.change !== null ? (
        <div className="flex flex-wrap gap-2">
          {can.change !== null ? (
            <Button asChild variant="outline" className={button}>
              <Link href={can.change}>
                <PenLineIcon aria-hidden="true" />
                {copy.actions.change}
              </Link>
            </Button>
          ) : null}
          {can.withdraw ? (
            <Button type="button" variant="ghost" className={button} onClick={() => setConfirming(true)}>
              <UndoIcon aria-hidden="true" />
              {copy.actions.withdraw}
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {copy.reasons[error]}
        </p>
      ) : null}
    </div>
  );
}
