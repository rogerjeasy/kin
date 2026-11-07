import { accountBalance, memberAccount, type Receipt } from "@kin/domain";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { CaregiverBillingError } from "./caregiver-billing.ts";
import { RECEIPT_TOPIC, creditReceipt, decideReceipt, submitReceipt } from "./receipts.ts";
import { asPerson, asService } from "./scope.ts";
import { readLedger } from "./ledger-store.ts";
import { seatPerson, visitorWithCircle, type VisitorCircle } from "./testing/index.ts";
import { serviceRows, snapshotFor, testDatabases } from "./testing/index.ts";

const db = testDatabases();
const NOW = new Date("2026-10-30T18:00:00Z");
const RECEIPT: Receipt = { category: "pharmacy", cents: 4200, description: "Elm Street Pharmacy, wound dressings", spentOn: "2026-10-28" };

type Seats = { circle: VisitorCircle; elena: string; marcus: string; rose: string; amara: string; daniel: string };

/** Rose's circle with a person in each seat. Elena, the organizer, is the visitor who pressed the button. */
async function circleWithSeats(): Promise<Seats> {
  const circle = await visitorWithCircle(db);
  const [marcus, rose, amara, daniel] = await Promise.all(
    (["marcus", "rose", "amara", "daniel"] as const).map((persona) => seatPerson(db, circle.circleId, circle.members[persona])),
  );
  return { circle, elena: circle.userId, marcus: marcus as string, rose: rose as string, amara: amara as string, daniel: daniel as string };
}

const file = (seats: Seats, userId: string, receipt: Receipt = RECEIPT, id = randomUUID()) =>
  asPerson(db.app, userId, (tx) => submitReceipt(tx, { circleId: seats.circle.circleId, id, receipt }));
const decide = (seats: Seats, userId: string, receiptId: string, approve: boolean) =>
  asPerson(db.app, userId, (tx) => decideReceipt(tx, { circleId: seats.circle.circleId, receiptId, approve }));
const stateOf = async (seats: Seats, receiptId: string) => (await serviceRows(db, seats.circle.circleId, "select state, decided_by, entry_id from receipts where id = $1", [receiptId]))[0];
const credit = (seats: Seats, receiptId: string) => asService(db.service, seats.circle.circleId, (tx) => creditReceipt(tx, seats.circle.circleId, receiptId, NOW));
const balanceOf = async (seats: Seats, memberId: string) => asService(db.service, seats.circle.circleId, async (tx) => accountBalance(await readLedger(tx, { id: seats.circle.circleId, currency: "USD" }), memberAccount(memberId)));

describe("a member's receipt", () => {
  it("is filed by a member who shares the cost, once however many times the request repeats", async () => {
    const seats = await circleWithSeats();
    const id = randomUUID();
    expect(await file(seats, seats.marcus, RECEIPT, id)).toBe(id);
    expect(await file(seats, seats.marcus, RECEIPT, id)).toBe(id);
    expect(await serviceRows(db, seats.circle.circleId, "select member_id, cents, state from receipts")).toEqual([{ member_id: seats.circle.members.marcus, cents: "4200", state: "submitted" }]);
    // The same key for a different receipt is a mistake, not a retry.
    await expect(file(seats, seats.marcus, { ...RECEIPT, cents: 9900 }, id)).rejects.toMatchObject({ reason: "key_reused" });
    await expect(file(seats, seats.elena, RECEIPT, id)).rejects.toMatchObject({ reason: "key_reused" });
  });

  it("is refused to every role that does not share the cost, and never dated in the future", async () => {
    const seats = await circleWithSeats();
    for (const userId of [seats.rose, seats.amara, seats.daniel]) {
      await expect(file(seats, userId)).rejects.toBeInstanceOf(CaregiverBillingError);
    }
    await expect(file(seats, seats.marcus, { ...RECEIPT, spentOn: "2026-10-31" })).rejects.toMatchObject({ reason: "invalid" });
    expect(await serviceRows(db, seats.circle.circleId, "select id from receipts")).toEqual([]);
  });

  it("is credited to the member who spent the money only after another member approves it", async () => {
    const seats = await circleWithSeats();
    const marcus = seats.circle.members.marcus;
    const before = await balanceOf(seats, marcus);
    const id = await file(seats, seats.marcus);

    // Nothing is queued, and nothing is credited, while it waits.
    expect(await serviceRows(db, seats.circle.circleId, "select id from outbox where topic = $1", [RECEIPT_TOPIC])).toEqual([]);
    expect(await credit(seats, id)).toBe("not_approved");

    await decide(seats, seats.elena, id, true);
    expect(await stateOf(seats, id)).toMatchObject({ state: "approved", decided_by: seats.circle.members.elena });
    expect(await serviceRows(db, seats.circle.circleId, "select payload from outbox where topic = $1", [RECEIPT_TOPIC])).toEqual([{ payload: { receiptId: id } }]);
    // Approving is not crediting: the ledger waits for the worker.
    expect(await balanceOf(seats, marcus)).toBe(before);

    expect(await credit(seats, id)).toBe("credited");
    expect(await balanceOf(seats, marcus)).toBe(before + 4200);
    const entries = (await asService(db.service, seats.circle.circleId, (tx) => readLedger(tx, { id: seats.circle.circleId, currency: "USD" }))).entries.filter((entry) => entry.source.id === `receipt-${id}`);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "out_of_pocket", simulated: true, description: "Receipt (simulated): Elm Street Pharmacy, wound dressings" });
    expect(entries[0]?.lines).toEqual([
      { account: "expense:pharmacy", direction: "debit", cents: 4200 },
      { account: memberAccount(marcus), direction: "credit", cents: 4200 },
    ]);
    expect(await stateOf(seats, id)).toMatchObject({ state: "credited" });
  });

  it("is credited once, however often its message is handed out", async () => {
    const seats = await circleWithSeats();
    const id = await file(seats, seats.marcus);
    await decide(seats, seats.elena, id, true);
    expect(await credit(seats, id)).toBe("credited");
    expect(await credit(seats, id)).toBe("already_credited");
    const count = await serviceRows(db, seats.circle.circleId, "select count(*)::int as n from ledger_entries where source_id = $1", [`receipt-${id}`]);
    expect(count).toEqual([{ n: 1 }]);
    // Deciding again after it was credited changes nothing and queues nothing more.
    await decide(seats, seats.elena, id, true);
    expect(await serviceRows(db, seats.circle.circleId, "select id from outbox where topic = $1", [RECEIPT_TOPIC])).toHaveLength(1);
  });

  it("is never decided by the member it would credit, nor by a role that does not share the cost", async () => {
    const seats = await circleWithSeats();
    const id = await file(seats, seats.marcus);
    for (const userId of [seats.marcus, seats.rose, seats.amara, seats.daniel]) {
      await expect(decide(seats, userId, id, true)).rejects.toMatchObject({ reason: "refused" });
    }
    expect(await stateOf(seats, id)).toMatchObject({ state: "submitted", decided_by: null });
    // The organizer files one too, and a contributor may answer it.
    const elenas = await file(seats, seats.elena);
    await decide(seats, seats.marcus, elenas, true);
    expect(await stateOf(seats, elenas)).toMatchObject({ state: "approved" });
  });

  it("is rejected without a credit, and a rejection stays rejected", async () => {
    const seats = await circleWithSeats();
    const id = await file(seats, seats.marcus);
    await decide(seats, seats.elena, id, false);
    expect(await stateOf(seats, id)).toMatchObject({ state: "rejected" });
    expect(await serviceRows(db, seats.circle.circleId, "select id from outbox where topic = $1", [RECEIPT_TOPIC])).toEqual([]);
    expect(await credit(seats, id)).toBe("not_approved");
    await expect(decide(seats, seats.elena, id, true)).rejects.toMatchObject({ reason: "not_waiting" });
  });

  it("is invisible and untouchable from another family's circle", async () => {
    const seats = await circleWithSeats();
    const other = await circleWithSeats();
    const id = await file(seats, seats.marcus);
    const stranger = await snapshotFor(db, other.elena, other.circle.circleId);
    expect(stranger.receipts).toEqual([]);
    await expect(asPerson(db.app, other.elena, (tx) => decideReceipt(tx, { circleId: seats.circle.circleId, receiptId: id, approve: true }))).rejects.toMatchObject({ reason: "refused" });
    await expect(asPerson(db.app, other.elena, (tx) => submitReceipt(tx, { circleId: seats.circle.circleId, id: randomUUID(), receipt: RECEIPT }))).rejects.toMatchObject({ reason: "refused" });
    await expect(asPerson(db.app, other.elena, (tx) => tx.execute(`update receipts set state = 'approved' where id = '${id}'` as never))).rejects.toThrow();
  });

  it("shows in the filer's snapshot, and the whole circle's for the roles that see the money", async () => {
    const seats = await circleWithSeats();
    const id = await file(seats, seats.marcus);
    const read = async (userId: string) => (await snapshotFor(db, userId, seats.circle.circleId)).receipts.map((receipt) => receipt.id);
    expect(await read(seats.marcus)).toEqual([id]);
    expect(await read(seats.elena)).toEqual([id]);
    expect(await read(seats.daniel)).toEqual([id]);
    expect(await read(seats.amara)).toEqual([]);
  });
});
