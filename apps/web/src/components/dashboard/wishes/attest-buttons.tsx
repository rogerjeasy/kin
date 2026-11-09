"use client";

import { BedIcon, HomeIcon, HouseIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { useWishRequest } from "./use-wish-request";

type Say = { readonly event: "hospital" | "care_home"; readonly stance: "start" | "end"; readonly label: string };
type Props = {
  readonly says: readonly Say[];
  readonly dismiss: { readonly triggerId: string; readonly label: string } | null;
  readonly reasons: Dictionary["dashboard"]["wishes"]["reasons"];
};

const ICONS = { hospital: BedIcon, care_home: HouseIcon } as const;

/** One person's word that something happened to the parent, or that she is home. The database counts the people. */
export function AttestButtons({ says, dismiss, reasons }: Props) {
  const { send, pending, error } = useWishRequest();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap gap-3">
        {says.map((say) => {
          const Icon = say.stance === "end" ? HomeIcon : ICONS[say.event];
          return (
            <Button key={`${say.event}-${say.stance}`} type="button" className="h-auto min-h-14 w-full max-w-full px-6 text-start text-base whitespace-normal sm:w-auto" disabled={pending} onClick={() => send({ operation: "attest", event: say.event, stance: say.stance })}>
              <Icon aria-hidden="true" />
              {say.label}
            </Button>
          );
        })}
        {dismiss ? (
          <Button type="button" variant="ghost" className="h-auto min-h-11 whitespace-normal" disabled={pending} onClick={() => send({ operation: "dismiss", triggerId: dismiss.triggerId })}>
            <XIcon aria-hidden="true" />
            {dismiss.label}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {reasons[error]}
        </p>
      ) : null}
    </div>
  );
}
