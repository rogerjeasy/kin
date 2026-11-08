import type { ToolOutput } from "@kin/agent";
import type { ExecutionRecord } from "@kin/db";
import type { EntryKind } from "@kin/domain";

import { recordEntries, type EntryView } from "@/content/circle/record";
import { fill } from "@/i18n/template";

import { named, type AskKinWorld, type PayPalReader } from "./world";

/**
 * Ask Kin's PayPal tools. They only read. Which PayPal resource to read is
 * always taken from the circle's own record, as the person may read it, never
 * from the model: a payout's batch from the execution that sent it, a top-up's
 * capture from its ledger entry, a share's subscription from its row. A demo
 * circle's simulated money has no PayPal resource behind it, and says so.
 */

/** PayPal reads per tool call, at most, so one question cannot fan out across PayPal. */
const PAYPAL_READS = 3;
const LIST = 5;
const IN_FLIGHT: readonly string[] = ["submitted", "pending_at_paypal", "unknown"];

type Read = (paypal: PayPalReader) => Promise<string>;

/** Reads PayPal for the first few real items; a simulated item, or a deployment without PayPal, is labelled instead. */
async function readEach<T>(world: AskKinWorld, items: readonly T[], read: (item: T) => Read | "simulated" | null): Promise<string[]> {
  let reads = 0;
  const statuses: string[] = [];
  for (const item of items) {
    const how = read(item);
    if (how === "simulated") statuses.push("simulated: no PayPal transaction stands behind it");
    else if (how === null || world.paypal === null) statuses.push("recorded by Kin; PayPal was not read");
    else if (reads >= PAYPAL_READS) statuses.push("recorded by Kin; not read again from PayPal");
    else {
      reads += 1;
      // PayPal's own reply is never shown: only its status word, or that it could not be read.
      statuses.push(await how(world.paypal).catch(() => "PayPal could not be read just now"));
    }
  }
  return statuses;
}

function entriesOf(world: AskKinWorld, kinds: readonly EntryKind[], name: string | undefined): EntryView[] {
  return recordEntries(world.circle)
    .filter((view) => kinds.includes(view.entry.kind) && named(name, world.names.subject(view.subject)))
    .slice(0, LIST);
}

function batchStatus(execution: ExecutionRecord | undefined): Read | null {
  const batchId = execution?.paypalBatchId ?? null;
  if (batchId === null) return null;
  return async (paypal) => {
    const batch = await paypal.getPayoutBatch(batchId);
    return `PayPal: ${batch.items.find((item) => item.itemId === execution?.paypalItemId)?.status ?? batch.batchStatus}`;
  };
}

export async function payoutStatus(world: AskKinWorld, payee: string | undefined): Promise<ToolOutput> {
  const { circle, format, names, copy } = world;
  const executions = await world.executions();
  const paid = entriesOf(world, ["payout_confirmed", "settlement_payout"], payee);
  const paidStatus = await readEach(world, paid, (view) => (view.entry.simulated ? "simulated" : batchStatus(executions.find((each) => each.paypalItemId === view.entry.source.id))));
  const proposals = new Map(circle.proposals.map((proposal) => [proposal.id, proposal]));
  const flying = executions.flatMap((execution) => {
    const proposal = proposals.get(execution.proposalId);
    if (!IN_FLIGHT.includes(execution.state) || proposal === undefined) return [];
    const to = "payeeId" in proposal.to ? names.payee(proposal.to.payeeId) : names.member(proposal.to.memberId);
    return named(payee, to) ? [{ execution, to, amount: format.money(proposal.cents) }] : [];
  });
  const flyingStatus = await readEach(world, flying, (each) => batchStatus(each.execution));
  const payouts = paid.map((view, index) => ({ to: names.subject(view.subject), amount: format.money(view.cents), day: format.day(view.entry.occurredOn), state: "paid", simulated: view.entry.simulated, paypal: paidStatus[index] ?? "" }));
  const underWay = flying.map((each, index) => ({ to: each.to, amount: each.amount, state: each.execution.state, paypal: flyingStatus[index] ?? "" }));

  const [last] = payouts;
  const [pending] = underWay;
  const fact = last
    ? fill(last.simulated ? copy.facts.payoutSimulated : copy.facts.payout, { payee: last.to, amount: last.amount, day: last.day })
    : pending
      ? fill(copy.facts.payoutPending, { payee: pending.to, amount: pending.amount })
      : payee === undefined
        ? copy.facts.payoutNoneAny
        : fill(copy.facts.payoutNone, { payee });
  return { data: { paid: payouts, underWay, note: "Kin records a payout as paid only once PayPal confirms it." }, fact };
}

export async function topUpStatus(world: AskKinWorld, member: string | undefined): Promise<ToolOutput> {
  const { format, names, copy } = world;
  const topUps = entriesOf(world, ["contribution"], member);
  const statuses = await readEach(world, topUps, (view) =>
    view.entry.simulated || view.entry.source.type !== "paypal_event" ? "simulated" : async (paypal) => `PayPal capture: ${(await paypal.getCapture(view.entry.source.id)).status}`,
  );
  const rows = topUps.map((view, index) => ({ member: names.subject(view.subject), amount: format.money(view.cents), day: format.day(view.entry.occurredOn), simulated: view.entry.simulated, paypal: statuses[index] ?? "" }));
  const [last] = rows;
  return {
    data: { topUps: rows },
    fact: last ? fill(last.simulated ? copy.facts.topUpSimulated : copy.facts.topUp, { member: last.member, amount: last.amount, day: last.day }) : copy.facts.topUpNone,
  };
}

export async function shareStatus(world: AskKinWorld, member: string | undefined): Promise<ToolOutput> {
  const { circle, format, names, copy } = world;
  const shares = circle.monthlyShares.filter((share) => named(member, names.member(share.memberId))).slice(0, LIST);
  const statuses = await readEach(world, shares, (share) => {
    const id = share.paypalSubscriptionId;
    return share.simulated || id === null ? "simulated" : async (paypal) => `PayPal subscription: ${(await paypal.getSubscription(id)).status}`;
  });
  const rows = shares.map((share, index) => ({
    member: names.member(share.memberId),
    amount: format.money(share.cents),
    state: share.state,
    nextCharge: share.nextBillingAt === null ? null : format.dateTime(share.nextBillingAt),
    failedPayments: share.failedPayments,
    simulated: share.simulated,
    paypal: statuses[index] ?? "",
  }));
  const [first] = rows;
  return { data: { shares: rows }, fact: first ? fill(copy.facts.share, { member: first.member, amount: first.amount }) : copy.facts.shareNone };
}
