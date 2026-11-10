import { calendarDay, purseFunded, purseWeekOf, type LedgerEntry } from "@kin/domain";
import { randomUUID } from "node:crypto";

import type { Transaction } from "../connection.ts";
import { pursePayees, purses } from "../schema/index.ts";
import type { DemoTime } from "./demo-time.ts";
import { ROSES_CIRCLE, type PersonaKey } from "./roses-circle.ts";
import { PURSE_FUNDED_AT, PURSE_PAYEES, PURSE_SET, PURSE_TERMS } from "./roses-purse.ts";

type Rows = {
  readonly circleId: string;
  readonly members: Readonly<Record<PersonaKey, string>>;
  readonly time: DemoTime;
};

/** Rose's Purse, made before its first float: the Purse's ID names the week's funding in the ledger. */
export function demoPurseId(): string {
  return randomUUID();
}

/**
 * This week's float into Rose's Purse, as the worker would have written it:
 * named by the Purse and the week, so the worker never moves it twice.
 */
export function demoPurseEntries(rows: Rows, purseId: string): LedgerEntry[] {
  const at = rows.time.at(PURSE_FUNDED_AT);
  const { occurredOn } = calendarDay(at, ROSES_CIRCLE.timezone);
  const header = {
    id: randomUUID(),
    circleId: rows.circleId,
    occurredOn,
    period: rows.time.period,
    source: { type: "approval" as const, id: `purse-week:${purseId}:${purseWeekOf(occurredOn)}` },
    currency: ROSES_CIRCLE.currency,
    simulated: true,
    description: "Weekly float to the parent's Purse (simulated)",
  };
  return [purseFunded(header, { cents: PURSE_TERMS.weeklyCents })];
}

/** The Purse and Rose's address book. Its float is in the ledger, written with Rose's month. */
export async function writePurse(tx: Transaction, rows: Rows, purseId: string): Promise<void> {
  const { circleId, members, time } = rows;
  await tx.insert(purses).values({
    id: purseId,
    circleId,
    parentMemberId: members.rose,
    ...PURSE_TERMS,
    status: "active",
    setBy: members[PURSE_SET.by],
    setAt: time.at(PURSE_SET.at),
    simulated: true,
  });
  await tx.insert(pursePayees).values(
    PURSE_PAYEES.map((payee) => ({
      id: randomUUID(),
      circleId,
      name: payee.name,
      relationship: payee.relationship,
      kind: payee.kind,
      aliases: [...payee.aliases],
      paypalReceiver: payee.paypalReceiver,
      addedBy: members[payee.addedBy],
      verifiedBy: payee.verifiedBy === null ? null : members[payee.verifiedBy],
      verifiedAt: payee.verifiedBy === null ? null : time.at(payee.at),
      simulated: true,
      createdAt: time.at(payee.at),
    })),
  );
}
