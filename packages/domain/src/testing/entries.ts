import type { EntryHeader, EntrySource, LedgerEntry } from "../ledger-entry.ts";
import {
  billApproved,
  careCreditLogged,
  contributionReceived,
  outOfPocketApproved,
  payoutConfirmed,
  purchaseCaptured,
  settlementCollected,
  settlementPaidOut,
} from "../postings.ts";
import type { Random } from "./property.ts";

export const TEST_CIRCLE = "circle-1";
export const TEST_CURRENCY = "USD";
export const TEST_PERIOD = "2026-10";

const MEMBERS = ["ana", "elena", "marcus"] as const;
const PAYEES = ["amara", "water"] as const;
const CATEGORIES = ["care", "pharmacy", "utilities"] as const;

/** An entry header for tests. `name` makes the ID and the source unique. */
export function testHeader(
  name: string,
  overrides: Partial<EntryHeader> = {},
): EntryHeader {
  const source: EntrySource = { type: "paypal_event", id: name };
  return {
    id: `entry-${name}`,
    circleId: TEST_CIRCLE,
    occurredOn: `${TEST_PERIOD}-15`,
    period: TEST_PERIOD,
    description: name,
    source,
    currency: TEST_CURRENCY,
    simulated: true,
    ...overrides,
  };
}

/** One entry of a random kind, with random amounts and parties. */
export function randomEntry(random: Random, name: string): LedgerEntry {
  const header = testHeader(name);
  const memberId = random.pick(MEMBERS);
  const payeeId = random.pick(PAYEES);
  const category = random.pick(CATEGORIES);
  const cents = random.int(1, 5_000_000);
  const moneyIn = {
    memberId,
    grossCents: cents + 1,
    feeCents: random.int(0, cents),
  };
  const builders = [
    () => contributionReceived(header, moneyIn),
    () => settlementCollected(header, moneyIn),
    () => outOfPocketApproved(header, { memberId, category, cents }),
    () => billApproved(header, { payeeId, category, cents }),
    () => payoutConfirmed(header, { payeeId, cents, feeCents: random.int(0, 2000) }),
    () => purchaseCaptured(header, { category, cents }),
    () => settlementPaidOut(header, { memberId, cents, feeCents: random.int(0, 2000) }),
    () =>
      careCreditLogged(header, {
        memberId,
        minutes: random.int(1, 600),
        rateCentsPerHour: random.int(60, 5000),
      }),
  ] as const;
  return random.pick(builders)();
}

export function randomEntries(random: Random): LedgerEntry[] {
  return Array.from({ length: random.int(1, 25) }, (_, index) =>
    randomEntry(random, `event-${index}`),
  );
}
