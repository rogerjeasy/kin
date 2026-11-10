"use client";

import { BuildingIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { postLetterJson, type LetterError } from "@/components/dashboard/letters/letter-client";
import { CopyField } from "@/components/dashboard/shift-links/copy-field";
import { CopyBlock } from "@/components/shared/copy-block";
import { Button } from "@/components/ui/button";
import { curlVisit } from "@/content/open-kin/connect-snippets";
import type { Dictionary } from "@/i18n/dictionary";

type Props = { copy: Dictionary["openKin"]["agency"]["create"]; tokenCopy: Dictionary["openKin"]["token"]; origin: string; caregiver: string };

type Created = { readonly ok: true; readonly keyId: string; readonly secret: string };

/** The organizer connects an agency: Kin makes a key and shows its secret once, with a signed example request. */
export function AgencyKeyForm({ copy, tokenCopy, origin, caregiver }: Props) {
  const id = useId();
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<keyof typeof copy.errors | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const labels = { copyLabel: tokenCopy.copy, copiedLabel: tokenCopy.copied, failedLabel: tokenCopy.failed };

  async function create() {
    setPending(true);
    setError(null);
    const reply = await postLetterJson<Created>("/api/agency-keys", { operation: "create", label });
    setPending(false);
    if (reply.ok) {
      setCreated(reply);
      setLabel("");
      router.refresh();
    } else {
      const reason = (reply as LetterError).reason;
      setError(reason in copy.errors ? (reason as keyof typeof copy.errors) : "unavailable");
    }
  }

  if (created) {
    return (
      <section aria-labelledby={`${id}-secret`} className="grid min-w-0 gap-4 rounded-3xl border border-gold/60 bg-highlight/5 shadow-[0_0_44px_-18px_rgb(var(--glow-gold)/0.8)] p-4 sm:p-5">
        <div className="min-w-0">
          <h3 id={`${id}-secret`} className="font-semibold">
            {copy.secretTitle}
          </h3>
          <p className="mt-1 text-sm text-pretty text-muted-foreground">{copy.secretText}</p>
        </div>
        <CopyField label={copy.keyId} value={created.keyId} {...labels} />
        <CopyField label={copy.secret} value={created.secret} {...labels} />
        <CopyBlock label="curl" value={curlVisit(origin, created.keyId, created.secret, caregiver)} {...labels} />
        <Button type="button" variant="outline" onClick={() => setCreated(null)} className="w-full sm:w-auto">
          {tokenCopy.done}
        </Button>
      </section>
    );
  }

  return (
    <form
      className="grid min-w-0 gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <h3 className="font-semibold">{copy.title}</h3>
      <Field id={`${id}-label`} label={copy.label}>
        <input id={`${id}-label`} required maxLength={80} autoComplete="organization" dir="auto" value={label} disabled={pending} onChange={(event) => setLabel(event.target.value)} className={inputClass} />
      </Field>
      <Button type="submit" variant="outline" disabled={pending || label.trim() === ""} className="h-auto min-h-11 w-full max-w-full whitespace-normal sm:w-auto">
        <BuildingIcon aria-hidden="true" />
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
