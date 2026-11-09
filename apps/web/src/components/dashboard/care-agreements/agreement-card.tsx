import { AGREEMENT_FOOTER, coveredFrom, signedAfterStart, type AgreementClause, type CareAgreementStatus } from "@kin/domain";
import { CircleCheckIcon, ClockIcon, FileTextIcon, ShieldCheckIcon } from "lucide-react";

import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";
import type { Formatters } from "@/lib/format";
import { fill } from "@/i18n/template";
import type { CareAgreementRecord } from "@kin/db";

import { AgreementActions } from "./agreement-actions";
import { AgreementText } from "./agreement-text";

type Props = {
  copy: Dictionary["dashboard"]["careAgreements"];
  agreement: CareAgreementRecord;
  caregiver: string;
  /** Who signed, by name, in the order they signed. */
  signers: readonly { readonly name: string; readonly capacity: "caregiver" | "care_recipient" | "representative"; readonly day: string }[];
  clauses: readonly AgreementClause[];
  rate: string;
  /** The first day the agreement that replaced this one covers, or `null` when none did. */
  replacedFrom: string | null;
  /** The caregiver's pay rate as money, when it is no longer the rate this agreement states and the agreement still governs. */
  movedPayRate: string | null;
  format: Formatters;
  today: string;
  can: { readonly sign: boolean; readonly withdraw: boolean; readonly end: boolean };
};

const TONES: Record<CareAgreementStatus, PillTone> = { draft: "waiting", scheduled: "waiting", active: "positive", ended: "neutral", withdrawn: "neutral" };

/** One care agreement: its status, its terms in a line each, who signed, the text, and what the viewer may do. */
export function AgreementCard({ copy, agreement, caregiver, signers, clauses, rate, replacedFrom, movedPayRate, format, today, can }: Props) {
  const card = copy.card;
  const from = coveredFrom(agreement.facts);
  const waiting = [
    agreement.signatures.some((signature) => signature.capacity === "caregiver") ? null : card.needCaregiver,
    agreement.signatures.some((signature) => signature.capacity !== "caregiver") ? null : card.needRecipient,
  ].filter((text): text is string => text !== null);
  const status = agreement.status;
  const statusText = status === "scheduled" ? fill(copy.status.scheduled, { day: format.day(from ?? agreement.startsOn) }) : copy.status[status];
  const end = agreement.endedOn ?? agreement.endsOn;

  return (
    <article className="min-w-0 space-y-4 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-balance wrap-anywhere">{caregiver}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {[fill(card.rate, { rate }), fill(card.hours, { hours: format.count(Math.trunc(agreement.weeklyMinutes / 60)) }), fill(card.starts, { day: format.day(agreement.startsOn) }), end === null ? card.ongoing : fill(card.endsOn, { day: format.day(end) })].join(" · ")}
          </p>
        </div>
        <StatusPill tone={TONES[status]} icon={status === "active" ? ShieldCheckIcon : status === "draft" ? ClockIcon : CircleCheckIcon}>
          {statusText}
        </StatusPill>
      </header>
      {from !== null ? <p className="text-sm">{fill(card.coveredFrom, { day: format.day(from) })}</p> : null}
      {signedAfterStart(agreement.facts) ? (
        <p className="text-sm text-highlight">{fill(card.lateSigned, { day: format.day(from ?? agreement.startsOn) })}</p>
      ) : null}
      <ul className="space-y-1 text-sm">
        {signers.map((signer) => (
          <li key={`${signer.name}-${signer.capacity}`} className="flex items-start gap-2">
            <CircleCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-positive" />
            <span className="min-w-0">{fill(card.signedBy, { name: signer.name, day: format.day(signer.day), capacity: card.capacity[signer.capacity] })}</span>
          </li>
        ))}
        {status === "draft" && waiting.length > 0 ? (
          <li className="flex items-start gap-2 text-muted-foreground">
            <ClockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">{fill(card.waitingFor, { who: waiting.join(" · ") })}</span>
          </li>
        ) : null}
      </ul>
      {replacedFrom !== null ? <p className="text-sm">{fill(card.replaced, { day: format.day(replacedFrom) })}</p> : null}
      {movedPayRate !== null ? (
        <p role="note" className="rounded-xl border border-highlight/40 bg-highlight/10 p-3 text-sm text-pretty">
          {fill(card.rateMoved, { name: caregiver, payRate: movedPayRate, rate })}
        </p>
      ) : null}
      {status === "active" || status === "scheduled" ? <p className="text-sm text-muted-foreground">{card.gate}</p> : null}
      <details className="group rounded-xl border bg-secondary/30 px-4 py-3">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <FileTextIcon aria-hidden="true" className="size-4 shrink-0" />
          {card.read}
        </summary>
        <div className="mt-3">
          <AgreementText clauses={clauses} footer={AGREEMENT_FOOTER} />
        </div>
      </details>
      {can.sign || can.withdraw || can.end ? <AgreementActions agreementId={agreement.id} copy={copy} can={can} today={today} /> : null}
    </article>
  );
}
