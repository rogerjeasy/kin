"use client";

import { UserPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { postLetterJson, type LetterError } from "@/components/dashboard/letters/letter-client";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { locales, type Locale } from "@/i18n/locales";

type Props = { locale: Locale; copy: Dictionary["dashboard"]["presence"]["voices"]; errors: Dictionary["dashboard"]["presence"]["errors"]; languageNames: Readonly<Record<Locale, string>> };

/** Adds a family member Kin may ask. The server checks the role, the number and the limit; this form only carries words. */
export function VoiceForm({ locale, copy, errors, languageNames }: Props) {
  const id = useId();
  const router = useRouter();
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [phone, setPhone] = useState("");
  const [aliases, setAliases] = useState("");
  const [language, setLanguage] = useState<Locale>(locale);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"added" | "addedWaiting" | null>(null);

  async function add() {
    setPending(true);
    setError(null);
    setDone(null);
    const reply = await postLetterJson<{ ok: true; confirmed?: boolean }>("/api/presence/voices", { operation: "add", name, relationship, phone, locale: language, aliases: aliases.split(",").map((each) => each.trim()).filter((each) => each !== "") });
    setPending(false);
    if (reply.ok) {
      setDone(reply.confirmed === true ? "added" : "addedWaiting");
      setName("");
      setRelationship("");
      setPhone("");
      setAliases("");
      router.refresh();
    } else setError((reply as LetterError).reason);
  }

  return (
    <form
      className="min-w-0 space-y-4 rounded-3xl border border-dashed bg-muted/50 p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <h3 className="font-semibold">{copy.addTitle}</h3>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field id={`${id}-name`} label={copy.nameLabel}>
          <input id={`${id}-name`} required maxLength={80} autoComplete="off" value={name} disabled={pending} onChange={(event) => setName(event.target.value)} className={inputClass} />
        </Field>
        <Field id={`${id}-relationship`} label={copy.relationshipLabel} hint={copy.relationshipHint}>
          <input id={`${id}-relationship`} aria-describedby={`${id}-relationship-hint`} required maxLength={80} autoComplete="off" value={relationship} disabled={pending} onChange={(event) => setRelationship(event.target.value)} className={inputClass} />
        </Field>
        <Field id={`${id}-phone`} label={copy.phoneLabel} hint={copy.phoneHint}>
          <input id={`${id}-phone`} aria-describedby={`${id}-phone-hint`} required inputMode="tel" autoComplete="off" dir="ltr" maxLength={24} value={phone} disabled={pending} onChange={(event) => setPhone(event.target.value)} className={inputClass} />
        </Field>
        <Field id={`${id}-aliases`} label={copy.aliasesLabel} hint={copy.aliasesHint}>
          <input id={`${id}-aliases`} aria-describedby={`${id}-aliases-hint`} dir="auto" maxLength={300} autoComplete="off" value={aliases} disabled={pending} onChange={(event) => setAliases(event.target.value)} className={inputClass} />
        </Field>
        <Field id={`${id}-language`} label={copy.languageLabel}>
          <select id={`${id}-language`} value={language} disabled={pending} onChange={(event) => setLanguage(event.target.value as Locale)} className={inputClass}>
            {locales.map((each) => (
              <option key={each} value={each}>
                {languageNames[each]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Button type="submit" disabled={pending || name.trim() === "" || relationship.trim() === "" || phone.trim() === ""} className="h-auto min-h-11 max-w-full whitespace-normal text-start">
        <UserPlusIcon aria-hidden="true" />
        {pending ? copy.adding : copy.submit}
      </Button>
      {error ? <p role="alert" className="text-sm text-danger">{errors[error as keyof typeof errors] ?? errors.unavailable}</p> : null}
      {done ? <p role="status" className="text-sm font-medium">{copy[done]}</p> : null}
    </form>
  );
}
