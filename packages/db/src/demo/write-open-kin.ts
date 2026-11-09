import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Transaction } from "../connection.ts";
import { agencyKeys, agencyVisitReports, delegationCalls, delegations } from "../schema/index.ts";
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
 * visits. Every row is marked seeded and says so on the screen; no token or
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
}
