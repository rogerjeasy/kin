import { calendarDay } from "@kin/domain";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Transaction } from "../connection.ts";
import { agencyInvoiceLines, agencyInvoicedVisits, agencyInvoices, agencyKeys, agencyVisitReports, bills, delegationCalls, delegations, payees } from "../schema/index.ts";
import type { DemoTime } from "./demo-time.ts";
import { ROSES_CIRCLE, type PersonaKey } from "./roses-circle.ts";
import { SCHEDULED_SHIFTS } from "./roses-shifts.ts";
import { todaysShiftWindow } from "./shift-window.ts";

type Rows = { readonly circleId: string; readonly members: Readonly<Record<PersonaKey, string>>; readonly time: DemoTime };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
/** A hash of random bytes nobody keeps: the sample's token and secret can never be used. */
const unusable = () => sha256(randomBytes(32).toString("base64url"));

/**
 * The demo's sample of Open Kin, so the screen tells its story the moment it
 * opens: Marcus connected his own assistant last week, it read what he owes
 * and then tried to approve, and was refused. And Amara's agency reports her
 * visits, and has sent its invoice for two of her earlier ones, which waits
 * on the Bills screen for a person's review. Every row is marked seeded and says so on the screen; no token or
 * secret behind them exists anywhere. The live console then makes real calls
 * with a delegation Kin issues for the visitor's own seat.
 */
export async function writeOpenKin(tx: Transaction, rows: Rows): Promise<void> {
  const { circleId, members, time } = rows;
  const now = time.now.getTime();
  const ago = (ms: number) => new Date(now - ms);

  const delegationId = randomUUID();
  await tx.insert(delegations).values({
    id: delegationId,
    circleId,
    memberId: members.marcus,
    label: "Marcus's Claude",
    scope: "propose",
    tokenHash: unusable(),
    tokenHint: randomBytes(3).toString("base64url"),
    seeded: true,
    expiresAt: new Date(now + 24 * DAY_MS),
    lastUsedAt: ago(2 * HOUR_MS),
    uses: 6,
    createdAt: ago(6 * DAY_MS),
  });
  const calls = [
    { tool: "get_fairness", outcome: "ok", durationMs: 41, at: ago(2 * HOUR_MS + 4 * MINUTE_MS) },
    { tool: "list_bills", outcome: "ok", durationMs: 37, at: ago(2 * HOUR_MS + 3 * MINUTE_MS) },
    { tool: "get_record", outcome: "ok", durationMs: 52, at: ago(2 * HOUR_MS + 2 * MINUTE_MS) },
    { tool: "approve_proposal", outcome: "unknown_tool", durationMs: 2, at: ago(2 * HOUR_MS + MINUTE_MS) },
    { tool: "get_pool", outcome: "ok", durationMs: 29, at: ago(2 * HOUR_MS) },
  ] as const;
  await tx.insert(delegationCalls).values(calls.map((call) => ({ id: randomUUID(), circleId, delegationId, ...call })));

  const keyId = randomUUID();
  await tx.insert(agencyKeys).values({
    id: keyId,
    circleId,
    label: "Sunrise Home Care",
    keyId: `agk_${randomBytes(16).toString("base64url")}`,
    secretHash: unusable(),
    seeded: true,
    createdBy: members.elena,
    createdAt: ago(10 * DAY_MS),
    lastUsedAt: ago(HOUR_MS),
  });

  // The agency's own visit-verification check-in for Amara's shift today: evidence beside it, which pays nothing.
  const [today] = SCHEDULED_SHIFTS;
  if (today === undefined) return;
  const window = todaysShiftWindow({ startsAt: time.at(today.startsAt), endsAt: time.at(today.endsAt) }, time.now, ROSES_CIRCLE.timezone);
  const checkedInAt = new Date(Math.min(window.startsAt.getTime() + 3 * MINUTE_MS, now));
  const body = {
    externalId: `sunrise-${window.startsAt.toISOString().slice(0, 10)}-amara`,
    caregiver: "Amara",
    kind: today.kind,
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
    checkedInAt: checkedInAt.toISOString(),
    note: "Arrived on time. Lunch and a short walk planned.",
  };
  const rawBody = JSON.stringify(body);
  await tx.insert(agencyVisitReports).values({
    id: randomUUID(),
    circleId,
    agencyKeyId: keyId,
    rawBody,
    bodySha256: sha256(rawBody),
    state: "accepted",
    externalId: body.externalId,
    caregiverName: body.caregiver,
    caregiverMemberId: members.amara,
    kind: body.kind,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    checkedInAt,
    minutes: Math.floor((window.endsAt.getTime() - window.startsAt.getTime()) / MINUTE_MS),
    note: body.note,
    seeded: true,
    receivedAt: new Date(Math.min(checkedInAt.getTime() + MINUTE_MS, now)),
  });
  await writeSampleInvoice(tx, { ...rows, keyId, todayStartsAt: window.startsAt });
}

/** What the sample agency charges an hour, in cents: what its invoice's lines are priced at. */
const SUNRISE_CENTS_PER_HOUR = 2_800;
const SUNRISE_PAYPAL = "billing@sunrise-homecare.example";

/**
 * Sunrise's invoice for Amara's visits three and two days ago, which it
 * reported at the time. No shift on Kin's calendar has the family's word for
 * them, so the Bills screen flags both lines: the point of the check. The
 * invoice waits for review like any bill; nothing is paid from it.
 */
async function writeSampleInvoice(tx: Transaction, rows: Rows & { readonly keyId: string; readonly todayStartsAt: Date }): Promise<void> {
  const { circleId, time, keyId } = rows;
  const day = (instant: Date) => calendarDay(instant, ROSES_CIRCLE.timezone).occurredOn;
  const visits = [3, 2].map((daysAgo) => {
    const startsAt = new Date(rows.todayStartsAt.getTime() - daysAgo * DAY_MS);
    const endsAt = new Date(startsAt.getTime() + 4 * HOUR_MS);
    const body = { externalId: `sunrise-${day(startsAt)}-amara`, caregiver: "Amara", kind: "aide", startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), checkedInAt: startsAt.toISOString(), checkedOutAt: endsAt.toISOString() };
    return { id: randomUUID(), body, rawBody: JSON.stringify(body), startsAt, endsAt };
  });
  await tx.insert(agencyVisitReports).values(
    visits.map((visit) => ({
      id: visit.id,
      circleId,
      agencyKeyId: keyId,
      rawBody: visit.rawBody,
      bodySha256: sha256(visit.rawBody),
      state: "accepted" as const,
      externalId: visit.body.externalId,
      caregiverName: "Amara",
      caregiverMemberId: rows.members.amara,
      kind: "aide" as const,
      startsAt: visit.startsAt,
      endsAt: visit.endsAt,
      checkedInAt: visit.startsAt,
      checkedOutAt: visit.endsAt,
      minutes: 240,
      seeded: true,
      receivedAt: new Date(visit.endsAt.getTime() + 5 * MINUTE_MS),
    })),
  );
  const lines = visits.map((visit) => ({ visitId: visit.body.externalId, minutes: 240, amountCents: 4 * SUNRISE_CENTS_PER_HOUR, currency: ROSES_CIRCLE.currency }));
  const totalCents = lines.reduce((total, line) => total + line.amountCents, 0);
  const today = day(time.now);
  const dueOn = day(new Date(time.now.getTime() + 14 * DAY_MS));
  const body = { invoiceNumber: "INV-1042", periodStart: day(visits[0]?.startsAt ?? time.now), periodEnd: today, lines, totalCents, currency: ROSES_CIRCLE.currency, dueOn, paypalEmail: SUNRISE_PAYPAL };
  const rawBody = JSON.stringify(body);
  const payeeId = randomUUID();
  const billId = randomUUID();
  const invoiceId = randomUUID();
  await tx.insert(payees).values({ id: payeeId, circleId, name: "Sunrise Home Care", category: "care", status: "new" });
  await tx.insert(bills).values({ id: billId, circleId, payeeId, amountCents: totalCents, dueOn, receivedOn: today, state: "needs_review" });
  await tx.insert(agencyInvoices).values({
    id: invoiceId,
    circleId,
    agencyKeyId: keyId,
    rawBody,
    bodySha256: sha256(rawBody),
    state: "accepted",
    invoiceNumber: body.invoiceNumber,
    periodStart: body.periodStart,
    periodEnd: body.periodEnd,
    totalCents,
    currency: body.currency,
    dueOn,
    paypalEmail: SUNRISE_PAYPAL,
    billId,
    seeded: true,
    receivedAt: new Date(time.now.getTime() - 30 * MINUTE_MS),
  });
  await tx.insert(agencyInvoiceLines).values(visits.map((visit, index) => ({ id: randomUUID(), circleId, invoiceId, position: index + 1, visitReportId: visit.id, minutes: 240, amountCents: 4 * SUNRISE_CENTS_PER_HOUR })));
  await tx.insert(agencyInvoicedVisits).values(visits.map((visit) => ({ id: randomUUID(), circleId, visitReportId: visit.id, invoiceId })));
}
