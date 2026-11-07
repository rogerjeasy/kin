import { asPerson, readCircle, takeDemoSeat, type CircleSnapshot } from "@kin/db";
import { serviceRows, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { testDatabases } from "../../../../packages/db/src/testing/databases.ts";

import { runSettlement } from "./settlement";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");

const snapshot = (circle: VisitorCircle): Promise<CircleSnapshot> => asPerson(db.app, circle.userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId: circle.userId, now: CLOCK }));
const as = (circle: VisitorCircle, persona: keyof VisitorCircle["members"]) => asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members[persona]));
const run = async (circle: VisitorCircle, input: unknown) => runSettlement({ db: db.app, userId: circle.userId, circle: await snapshot(circle) }, input);
const receipt = (change: Record<string, unknown> = {}) => ({ operation: "receipt_submit", id: randomUUID(), category: "pharmacy", amount: "42.00", description: "Elm Street Pharmacy, dressings", spentOn: "2026-10-28", ...change });

describe("receipts at the untrusted request boundary", () => {
  it("files a receipt for the member, and again with the same ID without filing it twice", async () => {
    const circle = await visitorWithCircle(db);
    await as(circle, "marcus");
    const input = receipt();
    expect(await run(circle, input)).toEqual({ ok: true, id: input.id });
    expect(await run(circle, input)).toEqual({ ok: true, id: input.id });
    const filed = (await snapshot(circle)).receipts;
    expect(filed.map((each) => [each.cents, each.state, each.memberId])).toEqual([[4200, "submitted", circle.members.marcus]]);
  });

  it("reads the amount digit by digit and refuses what the money core refuses", async () => {
    const circle = await visitorWithCircle(db);
    for (const change of [
      { amount: "1e3" }, { amount: "-5.00" }, { amount: "4.2.1" }, { amount: "" }, { amount: "0.00" }, { amount: "100000.01" }, { amount: 42 },
      { category: "caregiver" }, { category: "" }, { description: "   " }, { description: "x".repeat(121) },
      { spentOn: "2026-10-31" }, { spentOn: "2026-13-01" }, { spentOn: "yesterday" }, { id: "not-a-uuid" },
    ]) {
      expect(await run(circle, receipt(change))).toEqual({ ok: false, reason: "invalid" });
    }
    expect((await snapshot(circle)).receipts).toEqual([]);
  });

  it("refuses forged and extra fields, an unknown operation and a body that is not an object", async () => {
    const circle = await visitorWithCircle(db);
    for (const input of [{ ...receipt(), memberId: circle.members.marcus }, { ...receipt(), state: "approved" }, { operation: "ledger_write" }, { operation: "receipt_decide", receiptId: randomUUID(), approve: "yes" }, null, "receipt", []]) {
      expect(await run(circle, input)).toMatchObject({ ok: false, reason: "invalid" });
    }
  });

  it("is refused to the roles that do not share the cost", async () => {
    const circle = await visitorWithCircle(db);
    for (const persona of ["daniel", "amara", "rose"] as const) {
      await as(circle, persona);
      expect(await run(circle, receipt())).toEqual({ ok: false, reason: "refused" });
    }
    expect((await snapshot(circle)).receipts).toEqual([]);
  });

  it("is decided by another member, never by the one it credits, and an observer decides nothing", async () => {
    const circle = await visitorWithCircle(db);
    await as(circle, "marcus");
    const filed = receipt();
    await run(circle, filed);
    const decide = (approve: boolean) => run(circle, { operation: "receipt_decide", receiptId: filed.id, approve });
    expect(await decide(true)).toEqual({ ok: false, reason: "refused" });
    await as(circle, "daniel");
    expect(await decide(true)).toEqual({ ok: false, reason: "refused" });
    await as(circle, "elena");
    expect(await decide(true)).toEqual({ ok: true, id: filed.id });
    expect((await snapshot(circle)).receipts.map((each) => each.state)).toEqual(["approved"]);
    // A decision already made cannot be reversed by a later one.
    expect(await decide(false)).toEqual({ ok: false, reason: "not_waiting" });
  });
});

describe("the settlement at the untrusted request boundary", () => {
  it("is put to the family once for the open month: the demo's own is already out, so a second is refused", async () => {
    const circle = await visitorWithCircle(db);
    expect(await run(circle, { operation: "propose" })).toEqual({ ok: false, reason: "settlement_exists" });
  });

  it("is put by the organizer alone, for the period open on the circle's clock, and nothing the browser names", async () => {
    const circle = await visitorWithCircle(db);
    await serviceRows(db, circle.circleId, "update settlements set state = 'superseded' where circle_id = $1", [circle.circleId]);
    await serviceRows(db, circle.circleId, "update proposals set state = 'cancelled' where kind = 'member_payout' and circle_id = $1", [circle.circleId]);
    expect(await run(circle, { operation: "propose", period: "2020-01" })).toEqual({ ok: false, reason: "invalid" });
    for (const persona of ["marcus", "rose", "daniel", "amara"] as const) {
      await as(circle, persona);
      expect(await run(circle, { operation: "propose" })).toEqual({ ok: false, reason: "refused" });
    }
    await as(circle, "elena");
    const result = await run(circle, { operation: "propose" });
    expect(result).toMatchObject({ ok: true });
    const live = (await snapshot(circle)).settlements.filter((each) => each.state !== "superseded");
    expect(live.map((each) => [each.period, each.state])).toEqual([["2026-10", "proposed"]]);
    expect(await run(circle, { operation: "propose" })).toEqual({ ok: false, reason: "settlement_exists" });
  });

  it("records where a member's own payout goes, and refuses what is not an address", async () => {
    const circle = await visitorWithCircle(db);
    await as(circle, "marcus");
    expect(await run(circle, { operation: "receiver", email: "marcus@personal.example.com" })).toMatchObject({ ok: true });
    expect(await run(circle, { operation: "receiver", email: "nobody" })).toEqual({ ok: false, reason: "receiver" });
    expect(await run(circle, { operation: "receiver", email: "a@b.example", memberId: circle.members.elena })).toEqual({ ok: false, reason: "invalid" });
    expect((await snapshot(circle)).settlementReceivers).toEqual([{ memberId: circle.members.marcus, receiver: "m••••@personal.example.com" }]);
    for (const persona of ["daniel", "amara"] as const) {
      await as(circle, persona);
      expect(await run(circle, { operation: "receiver", email: "x@personal.example.com" })).toEqual({ ok: false, reason: "refused" });
    }
  });
});
