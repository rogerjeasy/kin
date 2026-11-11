"use client";

import { KeyRoundIcon, ShieldCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { postLetterJson, type LetterError } from "@/components/dashboard/letters/letter-client";
import { QrSvg } from "@/components/dashboard/shift-links/qr-svg";
import { CopyField } from "@/components/dashboard/shift-links/copy-field";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { QrCode } from "@/server/qr-code";

type Copy = Dictionary["dashboard"]["security"];
type Started = { readonly ok: true; readonly secret: string; readonly qr: QrCode };
type ErrorKey = keyof Copy["errors"];

const ROUTE = "/api/account/authenticator";

/** Groups a base32 key in fours, as people copy it by eye. */
const grouped = (secret: string) => secret.replace(/(.{4})(?=.)/g, "$1 ");

/**
 * Sets up the person's authenticator app: the server starts it and returns
 * the key once, the person scans it and types a code back. The server and
 * the user pool decide everything; this only carries the code.
 */
export function AuthenticatorSetup({ copy, onSignInAgain }: { copy: Copy; onSignInAgain: ReactNode }) {
  const id = useId();
  const router = useRouter();
  const [started, setStarted] = useState<Started | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [done, setDone] = useState(false);

  function fail(reply: LetterError) {
    setError(reply.reason in copy.errors ? (reply.reason as ErrorKey) : "unavailable");
  }

  async function begin() {
    setPending(true);
    setError(null);
    const reply = await postLetterJson<Started>(ROUTE, { operation: "begin" });
    setPending(false);
    if (reply.ok) setStarted(reply);
    else fail(reply as LetterError);
  }

  async function confirm() {
    setPending(true);
    setError(null);
    const reply = await postLetterJson<{ readonly ok: true }>(ROUTE, { operation: "confirm", code });
    setPending(false);
    if (reply.ok) {
      setDone(true);
      router.refresh();
    } else fail(reply as LetterError);
  }

  const problem = error ? (
    <div role="alert" className="grid min-w-0 gap-3 text-sm text-danger">
      <p className="text-pretty">{copy.errors[error]}</p>
      {error === "sign_in_again" ? onSignInAgain : null}
    </div>
  ) : null;

  if (done) {
    return (
      <p role="status" className="flex min-w-0 items-start gap-2 text-pretty">
        <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-positive" />
        <span className="min-w-0">{copy.done}</span>
      </p>
    );
  }

  if (started === null) {
    return (
      <div className="grid min-w-0 gap-4">
        <Button type="button" onClick={() => void begin()} disabled={pending} className="h-auto min-h-12 w-full max-w-full whitespace-normal sm:w-auto">
          <KeyRoundIcon aria-hidden="true" />
          {pending ? copy.beginning : copy.begin}
        </Button>
        {problem}
      </div>
    );
  }

  return (
    <form
      className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:items-start"
      onSubmit={(event) => {
        event.preventDefault();
        void confirm();
      }}
    >
      <QrSvg code={started.qr} label={copy.qrLabel} className="mx-auto max-w-56 md:mx-0" />
      <div className="grid min-w-0 gap-4">
        <p className="text-pretty">{copy.scan}</p>
        <CopyField label={copy.manual} value={grouped(started.secret)} copyLabel={copy.copy} copiedLabel={copy.copied} failedLabel={copy.copyFailed} />
        <Field id={`${id}-code`} label={copy.code} hint={copy.codeHint}>
          <input
            id={`${id}-code`}
            aria-describedby={`${id}-code-hint`}
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            dir="ltr"
            value={code}
            disabled={pending}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            className={`${inputClass} max-w-48 font-mono text-lg tracking-widest`}
          />
        </Field>
        <Button type="submit" disabled={pending || code.length !== 6} className="h-auto min-h-12 w-full max-w-full whitespace-normal sm:w-auto">
          <ShieldCheckIcon aria-hidden="true" />
          {pending ? copy.confirming : copy.confirm}
        </Button>
        {problem}
      </div>
    </form>
  );
}
