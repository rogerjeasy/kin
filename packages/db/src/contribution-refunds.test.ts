import { accountBalance, memberAccount, reverseEntry } from "@kin/domain";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { recordContributionRefund, type ConfirmedRefund } from "./contribution-refunds.ts";
import { recordContribution, type ConfirmedCapture } from "./contributions.ts";
import { readAccountIds, readLedger, writeEntries } from "./ledger-store.ts";
import { asService } from "./scope.ts";
import { testDatabases, visitorWithCircle, type VisitorCircle } from "./testing/index.ts";

const db = testDatabases();

const paypalId = (prefix: string) => `${prefix}${randomUUID().replaceAll("-", "").slice(0, 14).toUpperCase()}`;
const usd = (cents: number) => ({ cents, currency: "USD" });

const capture = (circle: VisitorCircle): ConfirmedCapture => ({
  captureId: paypalId("CAP"),
  memberId: circle.members.marcus,
  gross: usd(2500),
  fee: usd(136),
  capturedAt: new Date("2026-11-01T15:00:00Z"),
});
const refundOf = (paid: ConfirmedCapture, overrides: Partial<ConfirmedRefund> = {}): ConfirmedRefund => ({
  captureId: paid.captureId,
  refundId: paypalId("REF"),
  completed: true,
  wholeCaptureRefunded: true,
  refunded: paid.gross,
  feeReturned: paid.fee,
  net: usd(paid.gross.cents - paid.fee.cents),
  totalRefunded: paid.gross,
  // 02:00 UTC on 1 December is still 30 November in Rose's New York.
  refundedAt: new Date("2026-12-01T02:00:00Z"),
  ...overrides,
});
const ledgerOf = (circleId: string) => asService(db.service, circleId, (tx) => readLedger(tx, { id: circleId, currency: "USD" }));
const refund = (circle: VisitorCircle, given: ConfirmedRefund) => asService(db.service, circle.circleId, (tx) => recordContributionRefund(tx, circle.circleId, given));

async function toppedUp() {
  const circle = await visitorWithCircle(db);
  const paid = capture(circle);
  await asService(db.service, circle.circleId, (tx) => recordContribution(tx, circle.circleId, paid));
  return { circle, paid, before: await ledgerOf(circle.circleId) };
}

describe("recording a refund of a top-up PayPal confirmed", () => {
  it("appends one reversal of the contribution, dated in the circle's timezone, and the pool and member return to before the top-up", async () => {
    const { circle, paid, before } = await toppedUp();
    const given = refundOf(paid);

    expect(await refund(circle, given)).toBe("reversed");

    const after = await ledgerOf(circle.circleId);
    const original = after.entries.find((entry) => entry.source.id === paid.captureId);
    const reversal = after.entries.find((entry) => entry.source.id === given.refundId);
    expect(reversal).toMatchObject({ kind: "contribution", reverses: original?.id, occurredOn: "2026-11-30", period: "2026-11", simulated: false });
    const marcus = memberAccount(circle.members.marcus);
    expect(accountBalance(after, marcus) - accountBalance(before, marcus)).toBe(-2500);
    expect(accountBalance(after, "pool_cash") - accountBalance(before, "pool_cash")).toBe(-(2500 - 136));
    expect(accountBalance(after, "fees") - accountBalance(before, "fees")).toBe(-136);
  });

  it("writes it once, for the same refund again or a reversal of the same capture", async () => {
    const { circle, paid } = await toppedUp();
    const given = refundOf(paid);
    expect(await refund(circle, given)).toBe("reversed");
    expect(await refund(circle, given)).toBe("already_reversed");
    expect(await refund(circle, refundOf(paid))).toBe("already_reversed");
    const ledger = await ledgerOf(circle.circleId);
    expect(ledger.entries.filter((entry) => entry.reverses !== null && ledger.entries.find((each) => each.id === entry.reverses)?.source.id === paid.captureId)).toHaveLength(1);
  });

  it("is refused by the database too, should a second reversal of the same entry get past the money core", async () => {
    const { circle, paid } = await toppedUp();
    expect(await refund(circle, refundOf(paid))).toBe("reversed");
    const second = asService(db.service, circle.circleId, async (tx) => {
      const ledger = await readLedger(tx, { id: circle.circleId, currency: "USD" });
      const original = ledger.entries.find((entry) => entry.source.id === paid.captureId);
      if (!original) throw new Error("No contribution");
      const again = reverseEntry(original, { id: randomUUID(), occurredOn: "2026-11-30", period: "2026-11", description: "Again", source: { type: "paypal_event", id: paypalId("REF") } });
      await writeEntries(tx, [again], await readAccountIds(tx, circle.circleId));
    });
    // UNIQUE (circle_id, reverses): an entry is reversed once, whoever writes.
    await expect(second).rejects.toMatchObject({ cause: { code: "23505", constraint: "ledger_entries_reversed_once" } });
  });

  it("writes nothing for a partial refund, a refund in which PayPal kept fee, or a capture this circle never recorded", async () => {
    const { circle, paid, before } = await toppedUp();
    expect(await refund(circle, refundOf(paid, { wholeCaptureRefunded: false, refunded: usd(1000), feeReturned: usd(0), net: usd(1000), totalRefunded: usd(1000) }))).toBe("partial_refund");
    expect(await refund(circle, refundOf(paid, { feeReturned: usd(0), net: usd(2500) }))).toBe("fee_differs");
    expect(await refund(circle, refundOf(paid, { captureId: paypalId("CAP") }))).toBe("unknown_capture");
    expect((await ledgerOf(circle.circleId)).entries).toHaveLength(before.entries.length);
  });

  it("cannot reverse another circle's top-up while acting for this one", async () => {
    const { circle, paid } = await toppedUp();
    const other = await visitorWithCircle(db);
    expect(await refund(other, refundOf(paid))).toBe("unknown_capture");
    const ledger = await ledgerOf(circle.circleId);
    const original = ledger.entries.find((entry) => entry.source.id === paid.captureId);
    expect(ledger.entries.filter((entry) => entry.reverses === original?.id)).toEqual([]);
  });
});
