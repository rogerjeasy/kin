import { asPerson, takeDemoSeat, type CircleSnapshot } from "@kin/db";
import { snapshotFor, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { PayPalShapeError, captureRequestId, type Inbox, type InboxMessage } from "@kin/paypal";
import { fakePool, type FakePool } from "@kin/paypal/testing";
import { beforeAll, describe, expect, it } from "vitest";

import { confirmTopUp, startTopUp } from "./top-ups";

const db = testDatabases();

function fakeInbox(options: { down?: boolean } = {}): Inbox & { sent: InboxMessage[] } {
  const sent: InboxMessage[] = [];
  return {
    sent,
    async send(message) {
      if (options.down) throw new Error("SQS unavailable");
      sent.push(message);
    },
    receive: async () => [],
    remove: async () => undefined,
  };
}

const input = (amount: unknown) => ({ amount, returnUrl: "https://kin.test/dashboard", description: "Top-up to Rose’s circle on Kin" });

let ids: VisitorCircle;
let organizer: CircleSnapshot;

beforeAll(async () => {
  ids = await visitorWithCircle(db);
  organizer = await snapshotFor(db, ids.userId, ids.circleId);
});

async function as(persona: keyof VisitorCircle["members"]): Promise<CircleSnapshot> {
  const visitor = await visitorWithCircle(db);
  await asPerson(db.app, visitor.userId, (tx) => takeDemoSeat(tx, visitor.circleId, visitor.members[persona]));
  return snapshotFor(db, visitor.userId, visitor.circleId);
}

describe("starting a top-up", () => {
  it("opens an order for the exact amount typed, naming the circle and the member", async () => {
    const pool = fakePool();
    const result = await startTopUp({ pool, inbox: fakeInbox() }, organizer, input(" 25.50 "));
    expect(result.ok).toBe(true);
    const order = pool.orders.get(result.ok ? result.orderId : "");
    expect(order).toMatchObject({ amount: { cents: 2550, currency: "USD" }, reference: { circleId: ids.circleId, memberId: organizer.viewer.memberId } });
  });

  it("refuses the roles that do not share the cost: the caregiver, the observer and the parent", async () => {
    for (const persona of ["amara", "daniel", "rose"] as const) {
      const pool = fakePool();
      expect(await startTopUp({ pool, inbox: fakeInbox() }, await as(persona), input("25.00"))).toEqual({ ok: false, reason: "role" });
      expect(pool.orders.size).toBe(0);
    }
  });

  it("lets a contributor top up", async () => {
    expect((await startTopUp({ pool: fakePool(), inbox: fakeInbox() }, await as("marcus"), input("25"))).ok).toBe(true);
  });

  it.each([
    [25, "amount"],
    ["25.005", "amount"],
    ["-25", "amount"],
    ["1e3", "amount"],
    ["0.99", "too_small"],
    ["5000.01", "too_large"],
  ])("refuses %j without asking PayPal", async (amount, reason) => {
    const pool = fakePool();
    expect(await startTopUp({ pool, inbox: fakeInbox() }, organizer, input(amount))).toEqual({ ok: false, reason });
    expect(pool.orders.size).toBe(0);
  });

  it("says PayPal failed when it cannot open the order", async () => {
    const pool = fakePool();
    pool.failNext = "createOrder";
    expect(await startTopUp({ pool, inbox: fakeInbox() }, organizer, input("25.00"))).toEqual({ ok: false, reason: "paypal" });
  });
});

describe("confirming a top-up", () => {
  async function approvedOrder(pool: FakePool, circle = organizer): Promise<string> {
    const started = await startTopUp({ pool, inbox: fakeInbox() }, circle, input("40.00"));
    if (!started.ok) throw new Error("not started");
    pool.approve(started.orderId);
    return started.orderId;
  }

  it("captures the approved order once and asks the worker to read it back from PayPal", async () => {
    const pool = fakePool();
    const inbox = fakeInbox();
    const orderId = await approvedOrder(pool);
    const result = await confirmTopUp({ pool, inbox }, organizer, orderId);
    expect(result).toEqual({ ok: true, captureId: pool.orders.get(orderId)?.captures[0]?.id });
    expect(inbox.sent).toEqual([{ kind: "order_captured", circleId: ids.circleId, orderId }]);
    expect(pool.requestIds.filter((id) => id === captureRequestId(orderId))).toHaveLength(1);
  });

  it("does not capture twice when the same order is confirmed again", async () => {
    const pool = fakePool();
    const orderId = await approvedOrder(pool);
    const first = await confirmTopUp({ pool, inbox: fakeInbox() }, organizer, orderId);
    const second = await confirmTopUp({ pool, inbox: fakeInbox() }, organizer, orderId);
    expect(second).toEqual(first);
    expect(pool.orders.get(orderId)?.captures).toHaveLength(1);
  });

  it("refuses to capture another member's order, or one PayPal does not know", async () => {
    const pool = fakePool();
    const marcus = await as("marcus");
    const theirs = await approvedOrder(pool, marcus);
    expect(await confirmTopUp({ pool, inbox: fakeInbox() }, organizer, theirs)).toEqual({ ok: false, reason: "not_yours" });
    expect(await confirmTopUp({ pool, inbox: fakeInbox() }, organizer, "UNKNOWN12345")).toEqual({ ok: false, reason: "not_yours" });
    expect(pool.orders.get(theirs)?.captures).toEqual([]);
  });

  it("says declined when PayPal refuses the capture, and asks the worker nothing", async () => {
    const pool = fakePool();
    const inbox = fakeInbox();
    const started = await startTopUp({ pool, inbox }, organizer, input("40.00"));
    // Never approved, so PayPal refuses to capture it.
    const result = await confirmTopUp({ pool, inbox }, organizer, started.ok ? started.orderId : "");
    expect(result).toEqual({ ok: false, reason: "declined" });
    expect(inbox.sent).toEqual([]);
  });

  it("asks the worker to look when PayPal could not be reached, because whether it captured is unknown", async () => {
    const pool = fakePool();
    const inbox = fakeInbox();
    const orderId = await approvedOrder(pool);
    pool.failNext = "captureOrder";
    expect(await confirmTopUp({ pool, inbox }, organizer, orderId)).toEqual({ ok: true, captureId: null });
    expect(inbox.sent).toEqual([{ kind: "order_captured", circleId: ids.circleId, orderId }]);
  });

  it("reports a capture PayPal declined as declined, not as one to wait for", async () => {
    const pool = fakePool();
    const inbox = fakeInbox();
    const orderId = await approvedOrder(pool);
    pool.captureStatus = "DECLINED";
    expect(await confirmTopUp({ pool, inbox }, organizer, orderId)).toEqual({ ok: false, reason: "declined" });
    expect(inbox.sent).toEqual([]);
  });

  it("waits for PayPal's word on a pending capture instead of watching the ledger for it", async () => {
    const pool = fakePool();
    const inbox = fakeInbox();
    const orderId = await approvedOrder(pool);
    pool.captureStatus = "PENDING";
    expect(await confirmTopUp({ pool, inbox }, organizer, orderId)).toEqual({ ok: true, captureId: null });
    expect(inbox.sent).toHaveLength(1);
  });

  it("treats a capture reply it cannot read as unknown, and asks the worker to look", async () => {
    const pool = fakePool();
    const inbox = fakeInbox();
    const orderId = await approvedOrder(pool);
    const garbled = {
      ...pool,
      captureOrder: async () => {
        throw new PayPalShapeError("capture amount");
      },
    };
    expect(await confirmTopUp({ pool: garbled, inbox }, organizer, orderId)).toEqual({ ok: true, captureId: null });
    expect(inbox.sent).toEqual([{ kind: "order_captured", circleId: ids.circleId, orderId }]);
  });

  it("still answers when the queue is down, since PayPal's webhook reaches the worker without it", async () => {
    const pool = fakePool();
    const orderId = await approvedOrder(pool);
    const result = await confirmTopUp({ pool, inbox: fakeInbox({ down: true }) }, organizer, orderId);
    expect(result.ok).toBe(true);
  });
});
