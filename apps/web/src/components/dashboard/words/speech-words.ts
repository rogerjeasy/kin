import type { CaregiverBill } from "@kin/domain";
import type { ProposalRecord } from "@kin/db";

import type { CircleNames } from "@/content/circle/names";
import type { Dictionary } from "@/i18n/dictionary";
import { numberLocaleOf, type Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { proposalTitle, recipientName } from "./proposal-words";

type Speech = Dictionary["dashboard"]["caregiverBilling"]["speech"];

/**
 * What Kin says aloud is filled from the record with fixed wording, never
 * written by a model, so every amount, day and name it speaks is the one
 * the screen shows (AGENTS.md section 7).
 */
export function durationWords(speech: Speech, locale: Locale, minutes: number): string {
  const hours = minutes / 60;
  const number = new Intl.NumberFormat(numberLocaleOf(locale), { maximumFractionDigits: 2 }).format(hours);
  const form = new Intl.PluralRules(numberLocaleOf(locale)).select(hours) === "one" ? speech.hoursOne : speech.hoursOther;
  return fill(form, { hours: number });
}

/** The caregiver's bill, read back before they submit it. */
export function billReadBack(speech: Speech, locale: Locale, format: Formatters, name: string, bill: CaregiverBill): string {
  const days = bill.lines.map((line) => fill(speech.readBackDay, { day: format.longCalendarDay(line.date), duration: durationWords(speech, locale, line.minutes) }));
  return fill(speech.readBack, { name, days: format.allOf(days), rate: format.money(bill.details.rateCentsPerHour), total: format.money(bill.cents) });
}

/** A proposal, read to the person who may answer it. */
export function proposalReadBack(dictionary: Dictionary, names: CircleNames, format: Formatters, proposal: ProposalRecord, month: string): string {
  return fill(dictionary.dashboard.approvals.voice.readBack, {
    title: proposalTitle(dictionary, names, proposal, month),
    amount: format.money(proposal.cents),
    payee: recipientName(names, proposal),
  });
}

/** The answer Kin heard, read back for a second yes before it is recorded (docs/architecture.md section 10.5). */
export function answerReadBack(dictionary: Dictionary, names: CircleNames, format: Formatters, proposal: ProposalRecord, decision: "approve" | "reject"): string {
  const { voice } = dictionary.dashboard.approvals;
  return fill(decision === "approve" ? voice.confirmApprove : voice.confirmReject, { amount: format.money(proposal.cents), payee: recipientName(names, proposal) });
}
