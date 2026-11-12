"use client";

import { PlugZapIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { postLetterJson, type LetterError } from "@/components/dashboard/letters/letter-client";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import { ScopeChoice } from "./scope-choice";
import { TokenReveal } from "./token-reveal";

type Props = { copy: Dictionary["openKin"]["grant"]; tokenCopy: Dictionary["openKin"]["token"]; lifetimes: readonly number[] };

type Granted = { readonly ok: true; readonly token: string; readonly endpoint: string };

/** Connects the member's own assistant: a name, a scope and a lifetime. The server makes the token and checks everything. */
export function GrantForm({ copy, tokenCopy, lifetimes }: Props) {
  const id = useId();
  const router = useRouter();
  const [label, setLabel] = useState(copy.labelDefault);
  const [scope, setScope] = useState<"read" | "propose">("read");
  const [days, setDays] = useState(lifetimes[2] ?? lifetimes[0] ?? 30);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<keyof typeof copy.errors | null>(null);
  const [granted, setGranted] = useState<Granted | null>(null);

  async function grant() {
    setPending(true);
    setError(null);
    const reply = await postLetterJson<Granted>("/api/connections", { operation: "grant", label, scope, days });
    setPending(false);
    if (reply.ok) {
      setGranted(reply);
      router.refresh();
    } else {
      const reason = (reply as LetterError).reason;
      setError(reason in copy.errors ? (reason as keyof typeof copy.errors) : "unavailable");
    }
  }

  if (granted) return <TokenReveal copy={tokenCopy} token={granted.token} endpoint={granted.endpoint} onDone={() => setGranted(null)} />;

  return (
    <form
      className="grid min-w-0 gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void grant();
      }}
    >
      <Field id={`${id}-label`} label={copy.label} hint={copy.labelHint}>
        <input id={`${id}-label`} aria-describedby={`${id}-label-hint`} required maxLength={60} autoComplete="off" dir="auto" value={label} disabled={pending} onChange={(event) => setLabel(event.target.value)} className={inputClass} />
      </Field>
      <ScopeChoice name={`${id}-scope`} legend={copy.scope} scopes={copy.scopes} value={scope} disabled={pending} onChange={setScope} />
      <Field id={`${id}-days`} label={copy.lifetime}>
        <select id={`${id}-days`} value={days} disabled={pending} onChange={(event) => setDays(Number(event.target.value))} className={inputClass}>
          {lifetimes.map((each) => (
            <option key={each} value={each}>
              {each === 1 ? copy.day : fill(copy.days, { count: String(each) })}
            </option>
          ))}
        </select>
      </Field>
      <Button type="submit" disabled={pending || label.trim() === ""} className="h-auto min-h-12 w-full max-w-full whitespace-normal sm:w-auto">
        <PlugZapIcon aria-hidden="true" />
        {pending ? copy.creating : copy.submit}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {copy.errors[error]}
        </p>
      ) : null}
    </form>
  );
}
