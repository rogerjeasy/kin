"use client";

import { PlugZapIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { postLetterJson, type LetterError } from "@/components/dashboard/letters/letter-client";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

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
      <fieldset className="grid min-w-0 gap-2">
        <legend className="font-medium">{copy.scope}</legend>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          {(["read", "propose"] as const).map((each) => (
            <label key={each} className="flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-2xl border bg-background/70 p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
              <input type="radio" name={`${id}-scope`} value={each} checked={scope === each} disabled={pending} onChange={() => setScope(each)} className="mt-1 size-4 shrink-0 accent-primary" />
              <span className="min-w-0">
                <span className="block font-semibold">{copy.scopes[each].title}</span>
                <span className="block text-sm text-pretty text-muted-foreground">{copy.scopes[each].text}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
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
