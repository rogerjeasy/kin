import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { InvoiceRequestError, closeInvoiceRequest, requestInvoice } from "../invoice-requests.ts";
import { invoiceRequests } from "../schema/index.ts";
import { asPerson, asService } from "../scope.ts";
import { visitorWithCircle, type VisitorCircle } from "../testing/circles.ts";
import { testDatabases } from "../testing/databases.ts";
import { REFUSED, countIn, errorCode } from "../testing/sql.ts";

const db = testDatabases();

const settlementOf = (circle: VisitorCircle) => ({
  circleId: circle.circleId,
  id: randomUUID(),
  memberId: circle.members.marcus,
  purpose: "settlement" as const,
  period: "2026-10",
  cents: 16_600,
  demoRecipient: null,
});
const ask = (userId: string, input: ReturnType<typeof settlementOf>) => asPerson(db.app, userId, (tx) => requestInvoice(tx, input));
const refusal = async (work: Promise<unknown>) => {
  try {
    await work;
    return "no error";
  } catch (error) {
    return error instanceof InvoiceRequestError ? error.reason : String(error);
  }
};

describe("requests for money by invoice, between families (AGENTS.md section 6)", () => {
  it("another circle can neither read nor write them, and a person cannot write the table at all", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    const { request } = await ask(theirs.userId, settlementOf(theirs));
    await asPerson(db.app, mine.userId, async (tx) => expect(await countIn(tx, "invoice_requests", theirs.circleId)).toBe(0));
    await asService(db.service, mine.circleId, async (tx) => expect(await countIn(tx, "invoice_requests", theirs.circleId)).toBe(0));
    // Asking in their circle, or closing their request, is refused.
    expect(await refusal(ask(mine.userId, settlementOf(theirs)))).toBe("refused");
    expect(await refusal(asPerson(db.app, mine.userId, (tx) => closeInvoiceRequest(tx, { circleId: theirs.circleId, id: request.id, state: "cancelled" })))).toBe("refused");
    // The service acting for my circle cannot touch theirs.
    const moved = await asService(db.service, mine.circleId, (tx) => tx.update(invoiceRequests).set({ state: "cancelled" }).where(eq(invoiceRequests.id, request.id)).returning({ id: invoiceRequests.id }));
    expect(moved).toEqual([]);
    // A person has no write on the table, even in their own circle.
    const insert = asPerson(db.app, theirs.userId, (tx) =>
      tx.insert(invoiceRequests).values({ id: randomUUID(), circleId: theirs.circleId, memberId: theirs.members.marcus, requestedBy: theirs.members.elena, purpose: "top_up", amountCents: 100, currency: "USD", simulated: true }),
    );
    expect(await errorCode(insert)).toBe(REFUSED.permission);
    const update = asPerson(db.app, theirs.userId, (tx) => tx.update(invoiceRequests).set({ state: "cancelled" }).where(eq(invoiceRequests.id, request.id)));
    expect(await errorCode(update)).toBe(REFUSED.permission);
  });
});
