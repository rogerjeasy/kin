import { allocate, planApprovals, type Agreement, type AgreementChange, type ParentLevel, type Share } from "@kin/domain";

import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { planLabel } from "./plan-words";

type Copy = Dictionary["dashboard"]["agreement"];
type PlanLabels = Dictionary["dashboard"]["common"]["planLabels"];

/** One change a new version makes, in a sentence. */
export function changeWords(copy: Copy, name: (memberId: string) => string, format: Formatters, parent: string, change: AgreementChange): string {
  const { changes } = copy;
  switch (change.kind) {
    case "share": {
      const who = { name: name(change.memberId) };
      if (change.fromBps === null) return fill(changes.shareAdded, { ...who, to: format.share(change.toBps ?? 0) });
      if (change.toBps === null) return fill(changes.shareRemoved, { ...who, from: format.share(change.fromBps) });
      return fill(changes.shareChanged, { ...who, from: format.share(change.fromBps), to: format.share(change.toBps) });
    }
    case "care_rate":
      if (change.toCents === null) return fill(changes.careRemoved, { from: format.money(change.fromCents ?? 0) });
      if (change.fromCents === null) return fill(changes.careSet, { to: format.money(change.toCents) });
      return fill(changes.careChanged, { from: format.money(change.fromCents), to: format.money(change.toCents) });
    case "care_cash":
      return change.to ? changes.careCashOn : changes.careCashOff;
    case "threshold": {
      const label = fill(copy.thresholds[change.which], { parent });
      if (change.fromCents === null) return fill(changes.thresholdSet, { label, to: format.money(change.toCents) });
      return fill(changes.thresholdChanged, { label, from: format.money(change.fromCents), to: format.money(change.toCents) });
    }
  }
}

/**
 * What the thresholds mean for bills of a few telling sizes: just under each
 * threshold's reach, just over it, and over the ceiling. Worked out by the
 * same approval engine that decides every real payment.
 */
export function approvalExamples(agreement: Pick<Agreement, "approvals">, parentLevel: ParentLevel, labels: PlanLabels, parent: string, now: Date): { cents: number; words: string }[] {
  const { ceilingCents, secondApprovalAboveCents, parentDecidesAboveCents } = agreement.approvals;
  const lowest = Math.min(parentDecidesAboveCents, secondApprovalAboveCents);
  const amounts = [lowest > 100 ? Math.floor(lowest / 200) * 100 : null, parentDecidesAboveCents + 100, secondApprovalAboveCents + 100, ceilingCents + 100]
    .filter((cents): cents is number => cents !== null && cents > 0)
    .filter((cents, index, all) => all.indexOf(cents) === index)
    .toSorted((a, b) => a - b);
  return amounts.map((cents) => {
    const plan = planApprovals({
      kind: "bill_payment",
      cents,
      payee: { status: "approved", member: null, autoPay: null },
      agreement: { version: 0, approvals: agreement.approvals },
      parentLevel,
      pausedUntil: null,
      now,
    });
    return { cents, words: fill(labels[planLabel(plan)], { parent }) };
  });
}

/** Who would pay what of a month's costs, shared exactly to the cent. */
export function shareExample(shares: readonly Share[], monthCents: number): { memberId: string; cents: number }[] {
  const parts = allocate(monthCents, shares.map((share) => share.bps));
  return shares.map((share, index) => ({ memberId: share.memberId, cents: parts[index] ?? 0 }));
}
