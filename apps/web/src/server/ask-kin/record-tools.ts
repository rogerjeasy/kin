import type { ToolOutput } from "@kin/agent";
import { InvalidDecimalError, centsFromDecimal, checkClaim } from "@kin/domain";

import { memberFairness, periodSettlement } from "@/content/circle/fairness";
import { openPeriod } from "@/content/circle/period";
import { waitingProposals } from "@/content/circle/proposal-view";
import { monthTotals, paidBills, recordEntries } from "@/content/circle/record";
import { upcomingBills } from "@/content/circle/upcoming";
import { fill } from "@/i18n/template";

import { claimRecord } from "../claim-record";
import { simulatedNote, type AskKinWorld } from "./world";

/**
 * Ask Kin's tools over the circle's own record. Each reads the snapshot the
 * screens read, as the person, through the same functions the screens call,
 * so a tool can show nothing its screen would not, and every amount is the
 * money core's, formatted as the screens print it.
 */

/** A list a tool hands back is never longer than this. */
const LIST = 8;
const OPEN_BILL_STATES: readonly string[] = ["received", "extracted", "needs_review", "ready", "proposed"];

export function getPool(world: AskKinWorld): ToolOutput {
  const period = openPeriod(world.circle);
  const totals = monthTotals(world.circle, period);
  const { format } = world;
  const values = { pool: format.money(totals.poolCents), month: format.month(period), paidIn: format.money(totals.paidInCents), paidOut: format.money(totals.paidOutCents), fees: format.money(totals.feesCents) };
  return { data: { ...values, simulated: world.circle.circle.demo }, fact: fill(world.copy.facts.pool, values) + simulatedNote(world) };
}

export function listBills(world: AskKinWorld, status: string): ToolOutput {
  const { circle, format, names, copy } = world;
  const upcoming = upcomingBills(circle).map((bill) => ({ payee: names.payee(bill.payeeId), expected: format.money(bill.expectedCents), due: format.day(bill.due) }));
  const waiting = circle.bills
    .filter((bill) => OPEN_BILL_STATES.includes(bill.state))
    .map((bill) => ({ payee: names.payee(bill.payeeId), amount: format.money(bill.amountCents), due: bill.dueOn === null ? null : format.day(bill.dueOn), state: bill.state }));
  const paid = paidBills(circle).map((bill) => ({ payee: names.payee(bill.payeeId), amount: format.money(bill.cents), paidOn: format.day(bill.paidOn), simulated: bill.simulated }));
  const wanted = (kind: string) => status === "all" || status === kind;
  const first = waiting[0];
  return {
    data: {
      counts: { waiting: waiting.length, upcoming: upcoming.length, paid: paid.length },
      ...(wanted("upcoming") ? { upcoming: upcoming.slice(0, LIST) } : {}),
      ...(wanted("waiting") ? { waiting: waiting.slice(0, LIST) } : {}),
      ...(wanted("paid") ? { paid: paid.slice(0, LIST) } : {}),
    },
    fact:
      fill(copy.facts.bills, { waiting: format.count(waiting.length), upcoming: format.count(upcoming.length), paid: format.count(paid.length) }) +
      (first ? ` ${fill(copy.facts.billWaiting, { payee: first.payee, amount: first.amount })}` : ""),
  };
}

export function getFairness(world: AskKinWorld): ToolOutput {
  const { circle, format, names, copy } = world;
  const period = openPeriod(circle);
  const month = format.month(period);
  const settlement = periodSettlement(circle, period);
  if (settlement === null) return { data: { available: false }, fact: copy.facts.fairnessNone };
  const members = memberFairness(settlement, circle).map(({ memberId, shareBps, position }) => ({
    member: names.member(memberId),
    share: format.share(shareBps),
    gave: format.money(position.contributedCents),
    fairShare: format.money(position.targetCents),
  }));
  const owesPool = settlement.plan.collections.map((each) => ({ member: names.member(each.memberId), amount: format.money(each.cents) }));
  const poolOwes = settlement.plan.payouts.map((each) => ({ member: names.member(each.memberId), amount: format.money(each.cents) }));
  const lines = [...owesPool.map((each) => fill(copy.facts.owesPool, each)), ...poolOwes.map((each) => fill(copy.facts.poolOwes, each))];
  return {
    data: { month, calculatedBy: "Kin's money core, from the ledger and the agreement", members, owesThePool: owesPool, thePoolOwes: poolOwes, simulated: circle.circle.demo },
    fact: [fill(copy.facts.fairness, { month }), ...(lines.length > 0 ? lines : [copy.facts.even])].join(" ") + simulatedNote(world),
  };
}

export function checkDemand(world: AskKinWorld, payee: string, amount: string | undefined): ToolOutput {
  const { circle, format, names, copy } = world;
  let claimedCents: number | null = null;
  if (amount !== undefined) {
    try {
      claimedCents = centsFromDecimal(amount, circle.circle.currency);
    } catch (error) {
      if (!(error instanceof InvalidDecimalError)) throw error;
      return { data: { checked: false, reason: "The amount is not one this circle's currency can hold." }, fact: copy.facts.claimUnreadable };
    }
  }
  const result = checkClaim({ claimedPayee: payee, claimedCents, ...claimRecord(circle) });
  const known = result.payeeId === null ? null : names.payee(result.payeeId);
  const claimed = claimedCents === null ? null : format.money(claimedCents);
  const last = result.lastPayment === null ? null : { amount: format.money(result.lastPayment.cents), day: format.day(result.lastPayment.day) };
  const values = { claimed: payee, payee: known ?? payee, amount: claimed ?? "", day: last?.day ?? "", paid: last?.amount ?? "" };
  return {
    data: { claimedPayee: payee, claimedAmount: claimed, verdict: result.verdict, reason: result.reason, knownPayee: known, lastPayment: last, decidedBy: "Kin's fixed claim check, not a model. Nobody was alerted." },
    fact: fill(copy.facts.claim[result.reason], values),
  };
}

export function listProposals(world: AskKinWorld): ToolOutput {
  const { circle, format, names, copy } = world;
  const waiting = waitingProposals(circle).map((view) => {
    const { to } = view.proposal;
    const people = [...new Set(view.slots.flatMap((slot) => slot.waitingFor))].map((id) => names.member(id));
    return { to: "payeeId" in to ? names.payee(to.payeeId) : names.member(to.memberId), amount: format.money(view.proposal.cents), purpose: view.proposal.purpose, waitingFor: people, paused: view.decision === "paused" };
  });
  const first = waiting[0];
  return {
    data: { count: waiting.length, waiting: waiting.slice(0, LIST), note: "Kin cannot answer for anyone; each person says yes on the Approvals screen." },
    fact:
      fill(copy.facts.proposals, { count: format.count(waiting.length) }) +
      (first ? ` ${fill(copy.facts.proposal, { to: first.to, amount: first.amount, people: first.waitingFor.length > 0 ? format.anyOf(first.waitingFor) : copy.facts.nobody })}` : ""),
  };
}

export function getRecord(world: AskKinWorld, limit: number): ToolOutput {
  const { circle, format, names, copy } = world;
  const entries = recordEntries(circle)
    .slice(0, limit)
    .map((view) => ({ day: format.day(view.entry.occurredOn), kind: view.entry.kind, about: names.subject(view.subject), amount: format.money(view.cents), simulated: view.entry.simulated }));
  const [latest] = entries;
  return { data: { count: entries.length, entries }, fact: latest ? fill(copy.facts.record, { day: latest.day, about: latest.about, amount: latest.amount }) : copy.facts.recordNone };
}
