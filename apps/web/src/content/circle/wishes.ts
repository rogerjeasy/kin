import type { CircleSnapshot, ShiftRecord, WishRecord, WishTriggerRecord } from "@kin/db";
import { attestationConflicts, attestationStillNeeded, wishApprovalFor, type AttestationConflicts, type InForceWish, type TriggerEvent } from "@kin/domain";

import type { WishNameBook } from "@/components/dashboard/words/wish-words";

import { parentNameOf } from "./members";

/** The names her wishes can hold, from the circle's own rows. */
export function wishNameBook(circle: CircleSnapshot): WishNameBook {
  return {
    parent: parentNameOf(circle),
    payees: Object.fromEntries(circle.payees.map((payee) => [payee.id, payee.name])),
    members: Object.fromEntries(circle.members.map((member) => [member.id, member.displayName])),
    subscriptions: Object.fromEntries(circle.wishes.subscriptions.map((each) => [each.id, each.name])),
  };
}

/** One wish as the screen shows it: its newest version, and the versions before it. */
export type WishView = { readonly current: WishRecord; readonly history: readonly WishRecord[] };

/**
 * Her wishes, newest version of each first in the order she said them. A wish
 * whose newest version is a change still waiting shows that change, with the
 * version in force behind it in the history.
 */
export function wishViews(circle: CircleSnapshot): WishView[] {
  const byKey = Map.groupBy(circle.wishes.wishes, (wish) => wish.wishKey);
  return [...byKey.values()]
    .flatMap((versions): WishView[] => {
      const [current, ...history] = versions.toSorted((a, b) => b.version - a.version);
      return current === undefined ? [] : [{ current, history }];
    })
    .toSorted((a, b) => (a.history.at(-1) ?? a.current).createdAt.getTime() - (b.history.at(-1) ?? b.current).createdAt.getTime());
}

/** The trigger that is reported or active, if any. At most one is open at a time. */
export const openTrigger = (circle: CircleSnapshot): WishTriggerRecord | null => circle.wishes.triggers.find((trigger) => trigger.state === "reported" || trigger.state === "active") ?? null;

/** The last trigger that ended, for "she came home on…". */
export const lastEnded = (circle: CircleSnapshot): WishTriggerRecord | null => circle.wishes.triggers.find((trigger) => trigger.state === "ended") ?? null;

/** Whether the viewer has already said so, for this trigger and stance. */
export const viewerSaid = (circle: CircleSnapshot, trigger: WishTriggerRecord, stance: "start" | "end"): boolean =>
  trigger.attestations.some((each) => each.memberId === circle.viewer.memberId && each.stance === stance);

/** Who has a stake in `event` by her wishes in force: the successor they name, and the caregiver they keep paid. */
export function conflictsOf(circle: CircleSnapshot, event: TriggerEvent): AttestationConflicts {
  const memberOfPayee = (payeeId: string) => circle.payees.find((payee) => payee.id === payeeId)?.payee.member?.memberId ?? null;
  return attestationConflicts(circle.wishes.wishes.filter((wish) => wish.state === "in_force"), event, memberOfPayee);
}

/** Who still must say so: anyone who may, or someone from the family when only the caregiver has. */
export const stillNeeded = (circle: CircleSnapshot, trigger: WishTriggerRecord, stance: "start" | "end") =>
  attestationStillNeeded(trigger.event, trigger.attestations, stance, conflictsOf(circle, trigger.event));

/**
 * The wishes that ask more people before a waiting payment may go, as plain
 * code reads them: a payment to a new payee over her amount while a trigger is
 * active. Empty when none applies, so a card shows nothing.
 */
export function wishesAsking(circle: CircleSnapshot, proposal: { readonly cents: number; readonly to: { readonly payeeId: string } | { readonly memberId: string } }): { readonly memberIds: readonly string[]; readonly wishes: readonly InForceWish[] } | null {
  const effects = circle.wishes.effects;
  const payeeStatus = "payeeId" in proposal.to ? (circle.payees.find((payee) => "payeeId" in proposal.to && payee.id === proposal.to.payeeId)?.payee.status ?? null) : null;
  const asked = wishApprovalFor(effects, { cents: proposal.cents, payeeStatus });
  if (asked === null || effects === null) return null;
  return { memberIds: asked.memberIds, wishes: effects.newPayees.filter((rule) => asked.wishIds.includes(rule.wish.id)).map((rule) => rule.wish) };
}

/** What one kept-paid caregiver's pay looks like now: their next shift, and what was paid to them since the trigger began. */
export type KeptPay = {
  readonly payeeId: string;
  readonly wish: InForceWish;
  readonly nextShift: ShiftRecord | null;
  readonly paid: readonly { readonly id: string; readonly cents: number; readonly at: Date; readonly settled: boolean }[];
};

/** For each caregiver her wishes keep paid: what is next and what went since the trigger became active. */
export function keptPay(circle: CircleSnapshot): KeptPay[] {
  const effects = circle.wishes.effects;
  if (effects === null) return [];
  const since = effects.trigger.activeAt.getTime();
  const now = circle.circle.now.getTime();
  return effects.keepPaying.map(({ payeeId, wish }) => {
    const shifts = circle.shifts.filter((shift) => shift.payeeId === payeeId && shift.state !== "cancelled");
    const nextShift = shifts.filter((shift) => shift.endsAt.getTime() >= now && shift.proposalId === null).toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0] ?? null;
    const paid = circle.proposals
      .filter((proposal) => "payeeId" in proposal.to && proposal.to.payeeId === payeeId && proposal.kind === "caregiver_payout" && proposal.raisedAt.getTime() >= since && ["approved", "executing", "settled"].includes(proposal.state))
      .map((proposal) => ({ id: proposal.id, cents: proposal.cents, at: proposal.raisedAt, settled: proposal.state === "settled" }));
    return { payeeId, wish, nextShift, paid };
  });
}
