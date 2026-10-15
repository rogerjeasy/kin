"use client";

import { useId, useState, type FormEvent } from "react";

import { ConsentField } from "@/components/account/consent-field";
import { SecureNote } from "@/components/account/secure-note";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

type StartFormProps = {
  /** Names the form for a screen reader: the id of its heading. */
  labelledBy: string;
  copy: Dictionary["startPage"]["form"];
  /** Where creating an account begins, and where to land after it. */
  action: string;
  next: string;
};

const CONSENT = "consent";

/**
 * The consent rule comes first. Once it is ticked, the form goes to Kin's
 * sign-in route, which sends the person on to create their account.
 */
export function StartForm({ labelledBy, copy, action, next }: StartFormProps) {
  const id = useId();
  const [error, setError] = useState<string | undefined>();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const consent = event.currentTarget.elements.namedItem(CONSENT);
    if (consent instanceof HTMLInputElement && !consent.checked) {
      event.preventDefault();
      setError(copy.consentError);
      consent.focus();
    }
  }

  return (
    <form noValidate aria-labelledby={labelledBy} action={action} method="get" onSubmit={handleSubmit} className="space-y-5">
      <input type="hidden" name="next" value={next} />
      <ConsentField id={`${id}-${CONSENT}`} name={CONSENT} label={copy.consent} error={error} />
      <Button type="submit" className="w-full whitespace-normal">
        {copy.submit}
      </Button>
      <SecureNote>{copy.note}</SecureNote>
    </form>
  );
}
