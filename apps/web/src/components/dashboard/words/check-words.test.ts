import { snapshotFor, testDatabases, visitorWithCircle } from "@kin/db/testing";
import type { CircleSnapshot, ClaimCheckRecord } from "@kin/db";
import { beforeAll, describe, expect, it } from "vitest";

import { circleNames } from "@/content/circle/names";
import { latestClaimCheck } from "@/content/circle/safety";
import { getDictionary } from "@/i18n/dictionary";
import { locales } from "@/i18n/locales";
import { formatters } from "@/lib/format";

import { checkWords } from "./check-words";

const db = testDatabases();
const format = formatters("en", "USD");
let circle: CircleSnapshot;

beforeAll(async () => {
  const visitor = await visitorWithCircle(db);
  circle = await snapshotFor(db, visitor.userId, visitor.circleId);
});

/** A check the office line or a presence check adds: a caller's demand for nobody Kin knows. */
const unknownPayee: ClaimCheckRecord = { id: "newer", checkedOn: "2026-10-30", payeeId: null, claimedCents: null, claim: "Someone from the bank asked Rose to read out her card number.", foundEntryId: null, verdict: "no_match", alerted: [] };
const newest = (check: ClaimCheckRecord): CircleSnapshot => ({ ...circle, claimChecks: [check, ...circle.claimChecks] });

async function wordsFor(snapshot: CircleSnapshot, place: "overview" | "bills", locale: (typeof locales)[number] = "en") {
  const dictionary = await getDictionary(locale);
  const check = latestClaimCheck(snapshot);
  if (!check) throw new Error("The circle holds a check");
  return checkWords({ dictionary, names: circleNames(snapshot, dictionary), format, parent: "Rose" }, check, place);
}

describe("the latest demand Kin checked", () => {
  it("tells the seeded false demand beside the real payment it contradicts", async () => {
    const overview = await wordsFor(circle, "overview");
    expect(overview.title).toBe("Kin caught a false demand");
    expect(overview.text).toContain("$300.00");
    expect(overview.text).toContain("$57.00");
    expect(overview).toMatchObject({ verdict: "Already paid", tone: "danger" });
    expect((await wordsFor(circle, "bills")).title).toContain("demanded $300.00");
  });

  it("tells a newer check of an unknown payee, rather than hiding every check", async () => {
    const words = await wordsFor(newest(unknownPayee), "overview");
    expect(words).toMatchObject({ title: "Kin flagged a demand that matches nothing on record", verdict: "Matches nothing on record", tone: "danger" });
    expect(words.text).toContain(unknownPayee.claim);
    expect(words.text).not.toContain("alerted");
  });

  it("says who was alerted when someone was", async () => {
    const words = await wordsFor(newest({ ...unknownPayee, alerted: circle.claimChecks[0]?.alerted ?? [] }), "bills");
    expect(words.text).toContain("Kin alerted Elena and Marcus.");
  });

  it("tells a demand that matches a real bill, and one it cannot confirm, by their own verdicts", async () => {
    expect(await wordsFor(newest({ ...unknownPayee, verdict: "match" }), "bills")).toMatchObject({ tone: "positive", verdict: "Matches a real bill" });
    expect(await wordsFor(newest({ ...unknownPayee, verdict: "unclear" }), "bills")).toMatchObject({ tone: "waiting", verdict: "Cannot be confirmed" });
  });

  it("tells a known payee's demand with no payment to compare without claiming one", async () => {
    const payeeId = circle.claimChecks[0]?.payeeId ?? null;
    const words = await wordsFor(newest({ ...unknownPayee, payeeId }), "overview");
    expect(words.verdict).toBe("Already paid");
    expect(words.title).toMatch(/^Kin checked a demand for .+: nothing is owed$/);
  });

  it("has words for every verdict in every language", async () => {
    for (const locale of locales) {
      for (const verdict of ["match", "no_match", "unclear"] as const) {
        const words = await wordsFor(newest({ ...unknownPayee, verdict }), "overview", locale);
        expect(words.title.length, `${locale} ${verdict}`).toBeGreaterThan(0);
        expect(words.text).toContain(unknownPayee.claim);
      }
    }
  });
});
