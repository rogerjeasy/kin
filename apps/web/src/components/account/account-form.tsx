"use client";

import { useId, useState, type FormEvent } from "react";

import { StatusNote } from "@/components/shared/status-note";
import { Button } from "@/components/ui/button";

import { ConsentField } from "./consent-field";
import { TextField } from "./text-field";

export type AccountField = {
  name: string;
  label: string;
  type: "text" | "email";
  autoComplete: string;
  placeholder: string;
  help?: string;
  /** What to say when the field is empty or badly formed. */
  error: string;
};

type AccountFormProps = {
  /** Names the form for a screen reader: the id of its heading. */
  labelledBy: string;
  fields: readonly AccountField[];
  consent?: { label: string; error: string };
  submit: string;
  /** A second way in, offered under the main button. */
  alternative?: { divider: string; label: string };
  /** What the form answers while accounts are closed. */
  closed: { title: string; text: string };
};

const CONSENT = "consent";

/**
 * The sign-in and start forms. Accounts are not built yet, so a correct form
 * sends nothing anywhere: it answers with the plain statement that accounts
 * are not open. The fields, the checks and the messages are the real ones.
 */
export function AccountForm({ labelledBy, fields, consent, submit, alternative, closed }: AccountFormProps) {
  const id = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [answered, setAnswered] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const controls = event.currentTarget.elements;
    const messages: [string, string][] = [...fields.map((field) => [field.name, field.error] as [string, string])];
    if (consent) {
      messages.push([CONSENT, consent.error]);
    }
    // The browser already knows whether each control is filled and well formed.
    const invalid = messages.filter(([name]) => {
      const control = controls.namedItem(name);
      return control instanceof HTMLInputElement && !control.validity.valid;
    });

    setErrors(Object.fromEntries(invalid));
    setAnswered(invalid.length === 0);
    const [first] = invalid;
    if (first) {
      const control = controls.namedItem(first[0]);
      if (control instanceof HTMLInputElement) control.focus();
    }
  }

  return (
    <form noValidate aria-labelledby={labelledBy} onSubmit={handleSubmit} className="space-y-5">
      {fields.map((field) => (
        <TextField key={field.name} id={`${id}-${field.name}`} {...field} error={errors[field.name]} />
      ))}
      {consent ? <ConsentField id={`${id}-${CONSENT}`} name={CONSENT} label={consent.label} error={errors[CONSENT]} /> : null}
      <Button type="submit" className="w-full whitespace-normal">
        {submit}
      </Button>
      {alternative ? (
        <>
          <p className="flex items-center gap-4 text-sm text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
            {alternative.divider}
          </p>
          <Button type="button" variant="outline" className="w-full whitespace-normal" onClick={() => setAnswered(true)}>
            {alternative.label}
          </Button>
        </>
      ) : null}
      <div role="status">{answered ? <StatusNote title={closed.title} text={closed.text} /> : null}</div>
    </form>
  );
}
