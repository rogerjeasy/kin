"use client";

import { PenLineIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { inputClass } from "@/components/dashboard/create-circle/field";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

import { useCareAgreementRequest } from "./use-care-agreement-request";

type Props = {
  agreementId: string;
  copy: Dictionary["dashboard"]["careAgreements"];
  can: { readonly sign: boolean; readonly withdraw: boolean; readonly end: boolean };
  /** The first day an agreement may be ended on: today. */
  today: string;
};

/** What the viewer may do with one agreement: sign it, withdraw a draft, or end a signed one. */
export function AgreementActions({ agreementId, copy, can, today }: Props) {
  const { send, pending, error } = useCareAgreementRequest();
  const router = useRouter();
  const [ending, setEnding] = useState(false);
  const [endedOn, setEndedOn] = useState(today);

  async function run(input: Record<string, unknown>) {
    const reply = await send({ agreementId, ...input });
    if (reply.ok) router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {can.sign ? (
          <Button type="button" disabled={pending} className="min-h-11" onClick={() => run({ operation: "sign" })}>
            <PenLineIcon aria-hidden="true" />
            {copy.actions.sign}
          </Button>
        ) : null}
        {can.withdraw ? (
          <Button type="button" variant="outline" disabled={pending} className="min-h-11" onClick={() => run({ operation: "withdraw" })}>
            {copy.actions.withdraw}
          </Button>
        ) : null}
        {can.end && !ending ? (
          <Button type="button" variant="outline" disabled={pending} className="min-h-11" onClick={() => setEnding(true)}>
            {copy.actions.end}
          </Button>
        ) : null}
      </div>
      {can.end && ending ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-0 gap-1.5 text-sm font-medium">
            {copy.actions.endOn}
            <input type="date" required min={today} value={endedOn} onChange={(event) => setEndedOn(event.target.value)} className={`${inputClass} sm:max-w-xs`} />
          </label>
          <Button type="button" disabled={pending} className="min-h-11" onClick={() => run({ operation: "end", endedOn })}>
            {copy.actions.confirmEnd}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {copy.errors[error] ?? copy.errors.unavailable}
        </p>
      ) : null}
    </div>
  );
}
