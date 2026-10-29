import { calendarDay, decimalAmount, percentFromBps, type VersionStatus } from "@kin/domain";
import type { AgreementVersionRecord, CircleSnapshot } from "@kin/db";

import type { AcceptanceItem } from "@/components/dashboard/agreement/acceptance-list";
import type { Draft } from "@/components/dashboard/agreement/draft";
import type { HistoryItem } from "@/components/dashboard/agreement/version-history";
import type { PillTone } from "@/components/dashboard/ui/status-pill";
import { approvalExamples, shareExample } from "@/components/dashboard/words/agreement-words";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { parentLevelOf } from "./members";
import type { CircleNames } from "./names";

type Copy = Dictionary["dashboard"]["agreement"];
type Methods = Dictionary["dashboard"]["approvals"]["slots"]["methods"];

/** The month a share example shares out: an even thousand in the circle's currency. */
const EXAMPLE_MONTH_CENTS = 100_000;

const TONES: Record<VersionStatus, PillTone> = { in_force: "positive", scheduled: "positive", awaiting: "waiting", superseded: "neutral", earlier: "neutral" };

export type AgreementWords = { readonly copy: Copy; readonly methods: Methods; readonly planLabels: Dictionary["dashboard"]["common"]["planLabels"]; readonly names: CircleNames; readonly format: Formatters; readonly parent: string };

export function statusWords(words: AgreementWords, version: AgreementVersionRecord): string {
  return fill(words.copy.statuses[version.status], { day: words.format.day(version.effectiveOn) });
}

/**
 * One version's terms in words: the shares, a month shared out, care and
 * every limit. The parent's threshold says so when the parent does not decide.
 */
export function termsView(words: AgreementWords, version: AgreementVersionRecord, parentDecides: boolean) {
  const { copy, names, format, parent } = words;
  const parts = shareExample(version.shares, EXAMPLE_MONTH_CENTS).map((part) => fill(copy.sharesPart, { amount: format.money(part.cents), name: names.member(part.memberId) }));
  const care = version.care;
  return {
    shares: version.shares.map((share) => ({ key: share.memberId, bps: share.bps, name: names.member(share.memberId) })),
    example: fill(copy.sharesExample, { amount: format.money(EXAMPLE_MONTH_CENTS), parts: format.allOf(parts) }),
    terms: [
      { label: copy.careLabel, value: care === null ? copy.careNone : fill(care.paidInCash ? copy.careCash : copy.careCredit, { rate: format.money(care.rateCentsPerHour) }) },
      {
        label: fill(copy.thresholds.parent, { parent }),
        value: parentDecides ? format.money(version.approvals.parentDecidesAboveCents) : fill(copy.parentNotDeciding, { amount: format.money(version.approvals.parentDecidesAboveCents), parent }),
      },
      { label: copy.thresholds.second, value: format.money(version.approvals.secondApprovalAboveCents) },
      { label: copy.thresholds.ceiling, value: format.money(version.approvals.ceilingCents) },
    ],
  };
}

/** Bills of a few telling sizes, and who must say yes to each under this version. */
export function examplesView(words: AgreementWords, circle: CircleSnapshot, version: AgreementVersionRecord) {
  return approvalExamples(version, parentLevelOf(circle), words.planLabels, words.parent, circle.circle.now).map((example) => ({
    amount: fill(words.copy.example, { amount: words.format.money(example.cents) }),
    words: example.words,
  }));
}

/** Who accepted a version, how and when, and whose acceptance it still waits for. */
export function acceptanceView(words: AgreementWords, version: AgreementVersionRecord): AcceptanceItem[] {
  const accepted = version.acceptances.map((each) => ({
    memberId: each.memberId,
    name: words.names.member(each.memberId),
    detail: fill(words.copy.acceptance, { method: words.methods[each.method], time: words.format.dateTime(each.at) }),
    accepted: true,
  }));
  const waiting = version.waitingFor.map((memberId) => ({ memberId, name: words.names.member(memberId), detail: words.copy.statuses.awaiting, accepted: false }));
  return [...accepted, ...waiting];
}

export function historyView(words: AgreementWords, versions: readonly AgreementVersionRecord[]): HistoryItem[] {
  const { copy, names, format } = words;
  return versions.toReversed().map((version) => ({
    id: version.id,
    title: fill(copy.historyVersion, { version: format.count(version.version) }),
    status: statusWords(words, version),
    tone: TONES[version.status],
    starts: fill(copy.historyStarts, { day: format.day(version.effectiveOn) }),
    accepted: version.acceptances.length === 0 ? copy.historyNobody : fill(copy.historyAccepted, { names: format.allOf(version.acceptances.map((each) => names.member(each.memberId))) }),
  }));
}

/**
 * Where the form starts: the version in force, as typed text, or for a first
 * agreement equal shares among the members who share the cost and no amounts.
 */
export function initialDraft(circle: CircleSnapshot, sharing: readonly string[]): Draft {
  const today = calendarDay(circle.circle.now, circle.circle.timezone).occurredOn;
  const agreement = circle.agreement;
  const currency = circle.circle.currency;
  const text = (cents: number) => decimalAmount({ cents, currency });
  if (agreement === null) {
    const even = sharing.length === 0 ? [] : evenShares(sharing.length);
    return { shares: Object.fromEntries(sharing.map((id, index) => [id, percentFromBps(even[index] ?? 0)])), careOn: false, careRate: "", careCash: false, parent: "", second: "", ceiling: "", effectiveOn: today };
  }
  return {
    shares: Object.fromEntries(agreement.shares.map((share) => [share.memberId, percentFromBps(share.bps)])),
    careOn: agreement.care !== null,
    careRate: agreement.care === null ? "" : text(agreement.care.rateCentsPerHour),
    careCash: agreement.care?.paidInCash ?? false,
    parent: text(agreement.approvals.parentDecidesAboveCents),
    second: text(agreement.approvals.secondApprovalAboveCents),
    ceiling: text(agreement.approvals.ceilingCents),
    effectiveOn: today,
  };
}

// 10 000 basis points shared as evenly as whole points allow, the first members taking any remainder.
function evenShares(count: number): number[] {
  const base = Math.floor(10_000 / count);
  return Array.from({ length: count }, (_, index) => base + (index < 10_000 - base * count ? 1 : 0));
}
