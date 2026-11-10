"use client";

import { HeartIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { useWishRequest } from "./use-wish-request";

type Props = { readonly label: string; readonly note: string; readonly reasons: Dictionary["dashboard"]["wishes"]["reasons"] };

/** The parent's own word that she is fine. Her wishes are hers to lift; the database ends it and records that it was her word. */
export function FineButton({ label, note, reasons }: Props) {
  const { send, pending, error } = useWishRequest();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Button type="button" className="h-auto min-h-16 w-full max-w-full px-6 text-xl whitespace-normal sm:w-auto" disabled={pending} onClick={() => send({ operation: "fine" })}>
        <HeartIcon aria-hidden="true" className="size-6" />
        {label}
      </Button>
      <p className="text-base text-pretty text-muted-foreground">{note}</p>
      {error ? (
        <p role="alert" className="text-base text-danger">
          {reasons[error]}
        </p>
      ) : null}
    </div>
  );
}
