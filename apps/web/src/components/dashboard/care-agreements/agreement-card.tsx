import { AGREEMENT_FOOTER, coveredFrom, signedAfterStart, type AgreementClause, type CareAgreementStatus } from "@kin/domain";
import { ChevronDownIcon, CircleCheckIcon, ClockIcon, FileTextIcon, ShieldCheckIcon, SignatureIcon } from "lucide-react";

import { IconTile } from "@/components/dashboard/ui/icon-tile";
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
    <article className="surface glow-edge min-w-0 space-y-5 rounded-3xl p-5 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          <IconTile icon={SignatureIcon} className="size-12 text-highlight" />
          <div className="min-w-0">
          <h3 className="text-xl font-semibold tracking-tight text-balance wrap-anywhere">{caregiver}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {[fill(card.rate, { rate }), fill(card.hours, { hours: format.count(Math.trunc(agreement.weeklyMinutes / 60)) }), fill(card.starts, { day: format.day(agreement.startsOn) }), end === null ? card.ongoing : fill(card.endsOn, { day: format.day(end) })].join(" · ")}
          </p>
          </div>
        </div>
        <StatusPill tone={TONES[status]} icon={status === "active" ? ShieldCheckIcon : status === "draft" ? ClockIcon : CircleCheckIcon}>
          {statusText}
        </StatusPill>
      </header>
      {from !== null ? <p className="text-sm">{fill(card.coveredFrom, { day: format.day(from) })}</p> : null}
      {signedAfterStart(agreement.facts) ? (
        <p className="text-sm text-highlight">{fill(card.lateSigned, { day: format.day(from ?? agreement.startsOn) })}</p>
      ) : null}
      <ul className="grid gap-2 text-sm">
        {signers.map((signer) => (
          <li key={`${signer.name}-${signer.capacity}`} className="flex items-start gap-2.5 rounded-xl border border-positive/20 bg-positive/5 px-3 py-2.5">
            <CircleCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-positive" />
            <span className="min-w-0">{fill(card.signedBy, { name: signer.name, day: format.day(signer.day), capacity: card.capacity[signer.capacity] })}</span>
          </li>
        ))}
        {status === "draft" && waiting.length > 0 ? (
          <li className="flex items-start gap-2.5 rounded-xl border border-dashed px-3 py-2.5 text-muted-foreground">
            <ClockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">{fill(card.waitingFor, { who: waiting.join(" · ") })}</span>
          </li>
        ) : null}
      </ul>
      {replacedFrom !== null ? <p className="text-sm">{fill(card.replaced, { day: format.day(replacedFrom) })}</p> : null}
      {movedPayRate !== null ? (
        <p role="note" className="rounded-2xl border border-highlight/40 bg-highlight/10 p-3.5 text-sm text-pretty">
          {fill(card.rateMoved, { name: caregiver, payRate: movedPayRate, rate })}
        </p>
      ) : null}
      {status === "active" || status === "scheduled" ? <p className="text-sm text-muted-foreground">{card.gate}</p> : null}
      <details className="group rounded-2xl border bg-muted/60 px-4 py-2 transition-colors duration-300 open:bg-card open:shadow-xs">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <FileTextIcon aria-hidden="true" className="size-4 shrink-0 text-highlight" />
          <span className="min-w-0 flex-1">{card.read}</span>
          <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-180" />
        </summary>
        <div className="enter mt-2 pb-3">
          <AgreementText clauses={clauses} footer={AGREEMENT_FOOTER} />
        </div>
      </details>
      {can.sign || can.withdraw || can.end ? <AgreementActions agreementId={agreement.id} copy={copy} can={can} today={today} /> : null}
    </article>
  );
}
