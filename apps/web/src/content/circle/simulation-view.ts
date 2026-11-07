import type { ScenarioResult } from "@kin/domain";
import type { CircleSnapshot } from "@kin/db";

import type { ComparisonRow } from "@/components/dashboard/simulator/member-comparison";
import type { PillTone } from "@/components/dashboard/ui/status-pill";
import { planLabel } from "@/components/dashboard/words/plan-words";
import { positionStatus } from "@/components/dashboard/words/given-rows";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import type { CircleNames } from "./names";

type Words = { readonly dictionary: Dictionary; readonly names: CircleNames; readonly format: Formatters; readonly parent: string };

/** Each member's share, agreed target and position before and under the scenario. */
export function comparisonRows({ dictionary, names, format }: Words, circle: CircleSnapshot, result: ScenarioResult): ComparisonRow[] {
  const copy = dictionary.dashboard.simulator;
  const position = dictionary.dashboard.fairness.members;
  return (circle.agreement?.shares ?? []).map((share) => {
    const find = (settlement: ScenarioResult["before"]) => settlement.fairness.positions.find((each) => each.memberId === share.memberId);
    const before = find(result.before);
    const after = find(result.after);
    const afterBps = result.agreement.shares.find((each) => each.memberId === share.memberId)?.bps ?? 0;
    const name = names.member(share.memberId);
    const line = (label: string, now: string, simulated: string) => ({ label, now, simulated, changed: now !== simulated });
    return {
      memberId: share.memberId,
      name,
      lines: [
        line(copy.share, format.share(share.bps), format.share(afterBps)),
        line(copy.target, format.money(before?.targetCents ?? 0), format.money(after?.targetCents ?? 0)),
      ],
      position: {
        now: positionStatus(format, before?.positionCents ?? 0, position, name).text,
        simulated: positionStatus(format, after?.positionCents ?? 0, position, name).text,
      },
    };
  });
}

const TONES = { standing_rule: "positive", mandate: "positive", refused: "danger", paused: "waiting", needs_approval: "waiting" } as const satisfies Record<string, PillTone>;

/** The hypothetical bill: who must say yes, what the pool holds and what a top-up would be. */
export function billWords({ dictionary, names, format, parent }: Words, bill: NonNullable<ScenarioResult["bill"]>) {
  const copy = dictionary.dashboard.simulator;
  const lines = [fill(copy.billPool, { amount: format.money(bill.poolCents) })];
  if (bill.shortfallCents === 0) lines.push(copy.billEnough);
  else {
    const parts = bill.topUps.filter((part) => part.cents > 0).map((part) => fill(copy.billPart, { amount: format.money(part.cents), name: names.member(part.memberId) }));
    lines.push(fill(copy.billShort, { amount: format.money(bill.shortfallCents), parts: format.allOf(parts) }));
  }
  return {
    title: fill(copy.billTitle, { amount: format.money(bill.cents) }),
    approval: { text: fill(dictionary.dashboard.common.planLabels[planLabel(bill.approval)], { parent }), tone: TONES[bill.approval.outcome] },
    lines,
  };
}
