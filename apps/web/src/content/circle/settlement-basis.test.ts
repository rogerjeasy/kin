import { billApproved, contributionReceived, type LedgerEntry } from "@kin/domain";
import { snapshotFor, testDatabases, visitorWithCircle } from "@kin/db/testing";
import type { CircleSnapshot } from "@kin/db";
import { beforeAll, describe, expect, it } from "vitest";

import { payoutReason, periodSettlement } from "./fairness";
import { settlementBasis } from "./settlement-basis";

const db = testDatabases();
let circle: CircleSnapshot;
let ids: Awaited<ReturnType<typeof visitorWithCircle>>;

beforeAll(async () => {
  ids = await visitorWithCircle(db);
  circle = await snapshotFor(db, ids.userId, ids.circleId);
});

const header = (id: string) => ({ id, circleId: circle.circle.id, occurredOn: "2026-10-30", period: "2026-10", description: id, source: { type: "approval" as const, id }, currency: "USD", simulated: true });
const withEntries = (...entries: LedgerEntry[]): CircleSnapshot => ({ ...circle, ledger: { ...circle.ledger, entries: [...circle.ledger.entries, ...entries] } });
const payoutTo = (snapshot: CircleSnapshot, memberId: string) => snapshot.proposals.find((proposal) => proposal.kind === "member_payout" && "memberId" in proposal.to && proposal.to.memberId === memberId);

describe("what a waiting settlement payout was worked out from", () => {
  it("names the month and the day, and stays quiet while fairness still agrees", () => {
    const elena = payoutTo(circle, ids.members.elena);
    expect(elena?.cents).toBe(12600);
    expect(elena && settlementBasis(circle, elena)).toEqual({ period: "2026-10", calculatedOn: "2026-10-30", memberId: ids.members.elena, nowOwedCents: null });
  });

  it("says what fairness owes the member today once the record has moved, and leaves the proposal's amount alone", () => {
    const moved = withEntries(contributionReceived(header("elena-top-up"), { memberId: ids.members.elena, grossCents: 3500, feeCents: 0 }));
    const today = periodSettlement(moved, "2026-10")?.plan.payouts ?? [];
    for (const memberId of [ids.members.elena, ids.members.ana]) {
      const proposal = payoutTo(moved, memberId);
      if (!proposal) throw new Error("The demo has a settlement payout to each member it owes");
      const owed = today.find((payout) => payout.memberId === memberId)?.cents ?? 0;
      expect(owed).not.toBe(proposal.cents);
      expect(settlementBasis(moved, proposal)?.nowOwedCents).toBe(owed);
    }
    expect(payoutTo(moved, ids.members.elena)?.cents).toBe(12600);
  });

  it("is nothing for a proposal that is not a settlement payout", () => {
    const others = circle.proposals.filter((proposal) => proposal.kind !== "member_payout");
    expect(others.length).toBeGreaterThan(0);
    for (const proposal of others) expect(settlementBasis(circle, proposal)).toBeNull();
  });
});

describe("why a settlement payout can go now, in part or not yet", () => {
  it("can go in full when the cash bills have not claimed covers it", () => {
    const settlement = periodSettlement(circle, "2026-10");
    if (!settlement) throw new Error("The organizer sees the settlement");
    expect(settlement.plan.payouts.map((payout) => payoutReason(circle, settlement, payout))).toEqual([
      { kind: "all", availableCents: 31018, restCents: 0 },
      { kind: "all", availableCents: 31018, restCents: 0 },
    ]);
  });

  it("is shared among everyone owed when bills have claimed most of the cash, and the rest waits", () => {
    const tight = withEntries(billApproved(header("big-bill"), { payeeId: circle.payees[0]?.id ?? "", category: "utilities", cents: 30000 }));
    const settlement = periodSettlement(tight, "2026-10");
    if (!settlement) throw new Error("The organizer sees the settlement");
    for (const payout of settlement.plan.payouts) {
      const reason = payoutReason(tight, settlement, payout);
      expect(reason.availableCents).toBe(1018);
      expect(reason.kind).toBe("shared");
      expect(reason.restCents + payout.releasableCents).toBe(payout.cents);
    }
  });

  it("waits whole when bills have claimed all of it", () => {
    const empty = withEntries(billApproved(header("all-of-it"), { payeeId: circle.payees[0]?.id ?? "", category: "utilities", cents: 31018 }));
    const settlement = periodSettlement(empty, "2026-10");
    if (!settlement) throw new Error("The organizer sees the settlement");
    for (const payout of settlement.plan.payouts) expect(payoutReason(empty, settlement, payout)).toEqual({ kind: "none", availableCents: 0, restCents: payout.cents });
  });
});
