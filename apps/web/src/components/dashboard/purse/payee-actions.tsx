"use client";

import { BadgeCheckIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";

import { inputClass } from "@/components/dashboard/create-circle/field";
import { formWell } from "@/components/dashboard/settlement/form-well.ts";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import { PurseError } from "./purse-error";
import { usePurseRequest } from "./use-purse-request";

type Copy = Dictionary["dashboard"]["purse"];

/** Verify an entry someone else added, or remove one. The database checks who may do either. */
export function PayeeActions({ payeeId, name, canVerify, canRemove, copy }: { payeeId: string; name: string; canVerify: boolean; canRemove: boolean; copy: Copy }) {
  const { send, pending, error } = usePurseRequest();
  if (!canVerify && !canRemove) return null;
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        {canVerify ? (
          <Button type="button" size="sm" disabled={pending} aria-label={fill(copy.book.verifyLabel, { name })} onClick={() => void send({ operation: "verify_payee", payeeId })} className="h-auto max-w-full whitespace-normal">
            <BadgeCheckIcon aria-hidden="true" />
            {copy.book.verify}
          </Button>
        ) : null}
        {canRemove ? (
          <Button type="button" size="sm" variant="ghost" disabled={pending} aria-label={fill(copy.book.removeLabel, { name })} onClick={() => void send({ operation: "remove_payee", payeeId })} className="h-auto max-w-full whitespace-normal">
            <Trash2Icon aria-hidden="true" />
            {copy.book.remove}
          </Button>
        ) : null}
      </div>
      <PurseError copy={copy.errors} error={error} money={() => ""} />
    </div>
  );
}

const KINDS = ["person", "charity", "shop"] as const;

/** Puts someone in her address book. A family member who did not add them verifies them before she can pay them without a wait. */
export function PayeeForm({ copy, parentName }: { copy: Copy; parentName: string }) {
  const id = useId();
  const { send, pending, error } = usePurseRequest();
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("person");
  const [receiver, setReceiver] = useState("");
  const [added, setAdded] = useState(false);
  const { add } = copy.book;

  async function submit() {
    setAdded(false);
    const reply = await send({ operation: "add_payee", name, relationship, kind, receiver });
    if (reply.ok) {
      setName("");
      setRelationship("");
      setReceiver("");
      setAdded(true);
    }
  }

  return (
    <form
      className={formWell}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3 className="font-semibold">{add.title}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 content-start gap-1.5">
          <label htmlFor={`${id}-name`} className="font-medium">{add.name}</label>
          <input id={`${id}-name`} required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} dir="auto" className={inputClass} />
        </div>
        <div className="grid min-w-0 content-start gap-1.5">
          <label htmlFor={`${id}-relationship`} className="font-medium">{add.relationship}</label>
          <input id={`${id}-relationship`} required maxLength={80} value={relationship} onChange={(event) => setRelationship(event.target.value)} dir="auto" className={inputClass} />
        </div>
        <div className="grid min-w-0 content-start gap-1.5">
          <label htmlFor={`${id}-kind`} className="font-medium">{add.kind}</label>
          <select id={`${id}-kind`} value={kind} onChange={(event) => setKind(KINDS.find((each) => each === event.target.value) ?? "person")} className={inputClass}>
            {KINDS.map((each) => (
              <option key={each} value={each}>
                {add.kinds[each]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid min-w-0 content-start gap-1.5">
          <label htmlFor={`${id}-receiver`} className="font-medium">{add.receiver}</label>
          <input id={`${id}-receiver`} type="email" required maxLength={254} value={receiver} onChange={(event) => setReceiver(event.target.value)} aria-describedby={`${id}-receiver-hint`} dir="ltr" className={inputClass} />
          <p id={`${id}-receiver-hint`} className="text-sm text-muted-foreground">{fill(add.receiverHint, { parent: parentName })}</p>
        </div>
      </div>
      <Button type="submit" disabled={pending || name.trim() === "" || relationship.trim() === "" || receiver.trim() === ""} className="h-auto max-w-full justify-self-start whitespace-normal">
        {add.submit}
      </Button>
      {added ? <p role="status" className="text-sm text-positive">{add.added}</p> : null}
      <PurseError copy={copy.errors} error={error} money={() => ""} />
    </form>
  );
}
