import { BILL_TRANSITIONS, EXECUTION_TRANSITIONS, PROPOSAL_TRANSITIONS, contributionReceived, reverseEntry } from "@kin/domain";
import { testHeader } from "@kin/domain/testing";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { Transaction } from "../connection.ts";
import { readAccountIds, readLedger, writeEntries } from "../ledger-store.ts";
import { agreementShares, approvals, ledgerEntries, ledgerLines, proposals } from "../schema/index.ts";
import { asService } from "../scope.ts";
import { visitorWithCircle, type VisitorCircle } from "../testing/circles.ts";
import { testDatabases } from "../testing/databases.ts";
import { REFUSED, errorCode } from "../testing/sql.ts";

const db = testDatabases();

const asCircleService = <T>(circle: VisitorCircle, work: (tx: Transaction) => Promise<T>) => asService(db.service, circle.circleId, work);

/** A contribution from Marcus, built by the money core for this circle. */
function contribution(circle: VisitorCircle, name: string, cents = 1000) {
  return contributionReceived(
    { ...testHeader(name), id: randomUUID(), circleId: circle.circleId, simulated: true },
    { memberId: circle.members.marcus, grossCents: cents, feeCents: 30 },
  );
}

async function anyEntryId(circle: VisitorCircle): Promise<string> {
  const [row] = await asCircleService(circle, (tx) => tx.select({ id: ledgerEntries.id }).from(ledgerEntries).limit(1));
  if (!row) throw new Error("The circle has no entries");
  return row.id;
}

describe("the ledger is append-only (AGENTS.md section 5, rule 2)", () => {
  it("refuses to change an entry or a line, even for Kin's own service", async () => {
    const circle = await visitorWithCircle(db);
    const entryId = await anyEntryId(circle);
    expect(await errorCode(asCircleService(circle, (tx) => tx.update(ledgerEntries).set({ description: "Edited" }).where(eq(ledgerEntries.id, entryId))))).toBe(REFUSED.restrict);
    expect(await errorCode(asCircleService(circle, (tx) => tx.update(ledgerLines).set({ cents: 1 }).where(eq(ledgerLines.entryId, entryId))))).toBe(REFUSED.restrict);
    expect(await errorCode(asCircleService(circle, (tx) => tx.delete(ledgerEntries).where(eq(ledgerEntries.id, entryId))))).toBe(REFUSED.permission);
  });

  it("refuses an update, a delete or a truncate even from the tables' owner", async () => {
    const circle = await visitorWithCircle(db);
    const entryId = await anyEntryId(circle);
    expect(await errorCode(db.admin.update(ledgerEntries).set({ description: "Edited" }).where(eq(ledgerEntries.id, entryId)))).toBe(REFUSED.restrict);
    expect(await errorCode(db.admin.delete(ledgerLines).where(eq(ledgerLines.entryId, entryId)))).toBe(REFUSED.restrict);
    expect(await errorCode(db.admin.execute(sql`truncate ledger_entries cascade`))).toBe(REFUSED.restrict);
  });

  it("keeps answers, agreement versions and the audit log as they were given", async () => {
    const circle = await visitorWithCircle(db);
    expect(await errorCode(db.admin.update(approvals).set({ decision: "reject" }).where(eq(approvals.circleId, circle.circleId)))).toBe(REFUSED.restrict);
    expect(await errorCode(db.admin.update(agreementShares).set({ bps: 1 }).where(eq(agreementShares.circleId, circle.circleId)))).toBe(REFUSED.restrict);
    expect(await errorCode(db.admin.execute(sql`delete from audit_log where circle_id = ${circle.circleId}`))).toBe(REFUSED.restrict);
  });

  it("corrects by a reversing entry, which may cancel an original only once", async () => {
    const circle = await visitorWithCircle(db);
    const original = contribution(circle, "to-reverse");
    const correction = (name: string) => reverseEntry(original, { id: randomUUID(), occurredOn: "2026-10-20", period: "2026-10", description: "Refunded", source: { type: "paypal_event", id: name } });
    await asCircleService(circle, async (tx) => writeEntries(tx, [original, correction("refund-1")], await readAccountIds(tx, circle.circleId)));
    const ledger = await asCircleService(circle, (tx) => readLedger(tx, { id: circle.circleId, currency: "USD" }));
    expect(ledger.entries.at(-1)?.reverses).toBe(original.id);
    expect(await errorCode(asCircleService(circle, async (tx) => writeEntries(tx, [correction("refund-2")], await readAccountIds(tx, circle.circleId))))).toBe(REFUSED.unique);
  });
});

describe("every entry balances (AGENTS.md section 5, rule 2)", () => {
  it("is checked when the transaction commits, so an unbalanced entry never lands", async () => {
    const circle = await visitorWithCircle(db);
    const entry = contribution(circle, "unbalanced");
    const unbalanced = { ...entry, lines: entry.lines.map((line, index) => (index === 0 ? { ...line, cents: line.cents + 1 } : line)) };
    expect(await errorCode(asCircleService(circle, async (tx) => writeEntries(tx, [unbalanced], await readAccountIds(tx, circle.circleId))))).toBe(REFUSED.check);
    const ledger = await asCircleService(circle, (tx) => readLedger(tx, { id: circle.circleId, currency: "USD" }));
    expect(ledger.entries.some((each) => each.id === entry.id)).toBe(false);
  });

  it("refuses an entry with a single line, or a line added in a later transaction", async () => {
    const circle = await visitorWithCircle(db);
    const entry = contribution(circle, "lonely");
    const lonely = { ...entry, lines: entry.lines.slice(0, 1) };
    expect(await errorCode(asCircleService(circle, async (tx) => writeEntries(tx, [lonely], await readAccountIds(tx, circle.circleId))))).toBe(REFUSED.check);

    const entryId = await anyEntryId(circle);
    const [line] = await asCircleService(circle, (tx) => tx.select().from(ledgerLines).where(eq(ledgerLines.entryId, entryId)).limit(1));
    if (!line) throw new Error("The entry has no lines");
    const late = asCircleService(circle, (tx) => tx.insert(ledgerLines).values({ ...line, id: randomUUID(), position: 99 }));
    expect(await errorCode(late)).toBe(REFUSED.restrict);
  });

  it("refuses an entry in a currency that is not the circle's", async () => {
    const circle = await visitorWithCircle(db);
    const euros = { ...contribution(circle, "euros"), currency: "EUR" };
    expect(await errorCode(asCircleService(circle, async (tx) => writeEntries(tx, [euros], await readAccountIds(tx, circle.circleId))))).toBe(REFUSED.check);
  });

  it("refuses a second entry from the same cause, so a replayed event cannot count twice", async () => {
    const circle = await visitorWithCircle(db);
    const first = contribution(circle, "sale-replayed");
    const replay = { ...contribution(circle, "sale-replayed"), id: randomUUID() };
    await asCircleService(circle, async (tx) => writeEntries(tx, [first], await readAccountIds(tx, circle.circleId)));
    expect(await errorCode(asCircleService(circle, async (tx) => writeEntries(tx, [replay], await readAccountIds(tx, circle.circleId))))).toBe(REFUSED.unique);
  });
});

describe("state machines only move forward (AGENTS.md section 5, rule 6)", () => {
  it("hold exactly the transitions the money core lists", async () => {
    const rows = await db.admin.execute<{ machine: string; from_state: string; to_state: string }>(
      sql`select machine, from_state, to_state from kin_private.state_transitions`,
    );
    const stored = rows.rows.map((row) => `${row.machine} ${row.from_state}>${row.to_state}`).toSorted();
    const listed = Object.entries({ proposal: PROPOSAL_TRANSITIONS, bill: BILL_TRANSITIONS, execution: EXECUTION_TRANSITIONS })
      .flatMap(([machine, table]) => Object.entries(table).flatMap(([from, tos]) => (tos as readonly string[]).map((to) => `${machine} ${from}>${to}`)))
      .toSorted();
    expect(stored).toEqual(listed);
  });

  it("let a proposal move along its diagram and nowhere else", async () => {
    const circle = await visitorWithCircle(db);
    const [proposal] = await asCircleService(circle, (tx) => tx.select({ id: proposals.id }).from(proposals).where(eq(proposals.purpose, "caregiverWeek")));
    if (!proposal) throw new Error("No proposal");
    const move = (state: typeof proposals.$inferSelect.state) =>
      errorCode(asCircleService(circle, (tx) => tx.update(proposals).set({ state }).where(and(eq(proposals.id, proposal.id)))));
    expect(await move("settled")).toBe(REFUSED.check);
    expect(await move("approved")).toBe("no error");
    expect(await move("pending_approval")).toBe(REFUSED.check);
    expect(await move("executing")).toBe("no error");
  });

  it("fix what a proposal asks for once it is raised: the amount and the payee never change", async () => {
    const circle = await visitorWithCircle(db);
    const change = (set: Partial<typeof proposals.$inferInsert>) =>
      errorCode(asCircleService(circle, (tx) => tx.update(proposals).set(set).where(eq(proposals.purpose, "stairlift"))));
    expect(await change({ cents: 1 })).toBe(REFUSED.restrict);
    expect(await change({ payeeId: circle.payees.gas })).toBe(REFUSED.restrict);
  });
});

describe("an agreement's shares", () => {
  it("must total exactly 10 000 basis points", async () => {
    const circle = await visitorWithCircle(db);
    const [share] = await asCircleService(circle, (tx) => tx.select().from(agreementShares).limit(1));
    if (!share) throw new Error("No share");
    // An extra share breaks the whole; the database refuses it at commit.
    const extra = asCircleService(circle, (tx) => tx.insert(agreementShares).values({ ...share, id: randomUUID(), memberId: circle.members.rose, position: 9, bps: 100 }));
    expect(await errorCode(extra)).toBe(REFUSED.check);
  });
});
