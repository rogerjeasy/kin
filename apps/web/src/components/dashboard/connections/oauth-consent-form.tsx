"use client";

import type { DelegationScope } from "@kin/domain";
import { PlugZapIcon } from "lucide-react";
import { useId, useState } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { postLetterJson, type LetterError } from "@/components/dashboard/letters/letter-client";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import { ScopeChoice } from "./scope-choice";

type Copy = Dictionary["openKin"]["oauth"];

type Props = {
  copy: Copy;
  scopes: Dictionary["openKin"]["grant"]["scopes"];
  scopeLabel: string;
  lifetimeCopy: { label: string; day: string; days: string };
  lifetimes: readonly number[];
  /** The client's authorization request, exactly as it arrived; the server reads it again. */
  query: string;
  requested: DelegationScope;
  canGrant: boolean;
  observerText: string;
};

type Answered = { readonly ok: true; readonly redirect: string };

/**
 * The member's answer: the scope and lifetime they choose, then yes or no.
 * The server decides everything and says where the browser goes next, a
 * code or a refusal at the client's own redirect URI.
 */
export function OAuthConsentForm({ copy, scopes, scopeLabel, lifetimeCopy, lifetimes, query, requested, canGrant, observerText }: Props) {
  const id = useId();
  const [scope, setScope] = useState<DelegationScope>(requested);
  const [days, setDays] = useState(lifetimes[2] ?? lifetimes[0] ?? 30);
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<keyof Copy["errors"] | null>(null);

  async function answer(decision: "allow" | "deny") {
    setPending(decision);
    setError(null);
    const reply = await postLetterJson<Answered>("/api/oauth/consent", decision === "allow" ? { query, decision, scope, days } : { query, decision });
    if (reply.ok) {
      // A full navigation to the client's own address, never a fetch: the code travels in the browser's address bar, as OAuth sends it.
      window.location.assign(reply.redirect);
      return;
    }
    setPending(null);
    const reason = (reply as LetterError).reason;
    setError(reason in copy.errors ? (reason as keyof Copy["errors"]) : "unavailable");
  }

  const busy = pending !== null;
  return (
    <form
      className="grid min-w-0 gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void answer("allow");
      }}
    >
      {canGrant ? (
        <>
          <ScopeChoice name={`${id}-scope`} legend={scopeLabel} scopes={scopes} value={scope} disabled={busy} onChange={setScope} />
          <Field id={`${id}-days`} label={lifetimeCopy.label}>
            <select id={`${id}-days`} value={days} disabled={busy} onChange={(event) => setDays(Number(event.target.value))} className={inputClass}>
              {lifetimes.map((each) => (
                <option key={each} value={each}>
                  {each === 1 ? lifetimeCopy.day : fill(lifetimeCopy.days, { count: String(each) })}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-sm text-pretty text-muted-foreground">{copy.revokeLater}</p>
        </>
      ) : (
        <p className="text-sm text-pretty text-muted-foreground">{observerText}</p>
      )}
      <div className="flex min-w-0 flex-wrap gap-3">
        {canGrant ? (
          <Button type="submit" disabled={busy} className="h-auto min-h-12 w-full max-w-full whitespace-normal sm:w-auto">
            <PlugZapIcon aria-hidden="true" />
            {pending === "allow" ? copy.allowing : copy.allow}
          </Button>
        ) : null}
        <Button type="button" variant="outline" disabled={busy} onClick={() => void answer("deny")} className="h-auto min-h-12 w-full max-w-full whitespace-normal sm:w-auto">
          {pending === "deny" ? copy.denying : copy.deny}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {copy.errors[error]}
        </p>
      ) : null}
    </form>
  );
}
