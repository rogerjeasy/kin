import { contributionReceived, type LedgerEntry } from "@kin/domain";
import { snapshotFor, testDatabases, visitorWithCircle } from "@kin/db/testing";
import type { CircleSnapshot } from "@kin/db";
import { beforeAll, describe, expect, it } from "vitest";

import { getDictionary } from "@/i18n/dictionary";
import { formatters } from "@/lib/format";

import { ledgerRows } from "./ledger-rows";
import { circleNames } from "./names";
import { feesKind, moneyKind, poolProvenance } from "./provenance";

const db = testDatabases();
let circle: CircleSnapshot;
let elena: string;

beforeAll(async () => {
  const visitor = await visitorWithCircle(db);
  circle = await snapshotFor(db, visitor.userId, visitor.circleId);
  elena = visitor.members.elena;
});

/** A top-up Elena made through PayPal's sandbox: real at PayPal, so not simulated. */
function sandboxTopUp(cents: number): LedgerEntry {
  return contributionReceived(
    { id: "sandbox-top-up", circleId: circle.circle.id, occurredOn: "2026-10-30", period: "2026-10", description: "Elena's top-up", source: { type: "paypal_event", id: "CAPTURE-1" }, currency: "USD", simulated: false },
    { memberId: elena, grossCents: cents, feeCents: 0 },
  );
}

const withEntries = (base: CircleSnapshot, ...entries: LedgerEntry[]): CircleSnapshot => ({ ...base, ledger: { ...base.ledger, entries: [...base.ledger.entries, ...entries] } });
const asRealCircle = (base: CircleSnapshot): CircleSnapshot => ({
  ...base,
  circle: { ...base.circle, demo: false },
  ledger: { ...base.ledger, entries: base.ledger.entries.map((entry) => ({ ...entry, simulated: false })) },
});

describe("the kind of a set of money facts", () => {
  it("is PayPal's only when nothing in it is simulated", () => {
    expect(moneyKind([{ simulated: false }, { simulated: false }], true)).toBe("paypal");
    expect(moneyKind([{ simulated: true }, { simulated: true }], false)).toBe("simulated");
    expect(moneyKind([{ simulated: true }, { simulated: false }], true)).toBe("mixed");
  });

  it("with nothing to go by, follows the circle: a demo is simulated", () => {
    expect(moneyKind([], true)).toBe("simulated");
    expect(moneyKind([], false)).toBe("paypal");
  });
});

describe("where the pool's money came from", () => {
  it("is simulated in the seeded demo circle, its fees too", () => {
    expect(poolProvenance(circle)).toEqual({ kind: "simulated", sandboxInCents: 0 });
    expect(feesKind(circle, "2026-10")).toBe("simulated");
  });

  it("is mixed once a visitor tops up through PayPal's sandbox, and says how much was real", () => {
    expect(poolProvenance(withEntries(circle, sandboxTopUp(5000)))).toEqual({ kind: "mixed", sandboxInCents: 5000 });
  });

  it("is PayPal's in a real circle", () => {
    const real = asRealCircle(circle);
    expect(poolProvenance(real).kind).toBe("paypal");
    expect(feesKind(real, "2026-10")).toBe("paypal");
  });
});

describe("the record's source column", () => {
  it("calls a simulated entry's cause a stand-in, never a PayPal event", async () => {
    const english = await getDictionary("en");
    const rows = ledgerRows(circle, english, circleNames(circle, english), formatters("en", "USD"));
    expect(rows.map((row) => row.source)).not.toContain("PayPal event");
    expect(rows.filter((row) => row.source === "Simulated").length).toBeGreaterThan(0);
    const real = asRealCircle(circle);
    expect(ledgerRows(real, english, circleNames(real, english), formatters("en", "USD")).map((row) => row.source)).toContain("PayPal event");
  });
});
