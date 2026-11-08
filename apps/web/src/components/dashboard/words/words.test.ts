import { snapshotFor, testDatabases, visitorWithCircle } from "@kin/db/testing";
import type { CircleSnapshot } from "@kin/db";
import { beforeAll, describe, expect, it } from "vitest";

import { circleNames } from "@/content/circle/names";
import { waitingProposals } from "@/content/circle/proposal-view";
import { recordEntries } from "@/content/circle/record";
import { upcomingBills } from "@/content/circle/upcoming";
import { getDictionary } from "@/i18n/dictionary";
import { locales } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";

import { describeEntry } from "./entry-words";
import { planLabel } from "./plan-words";
import { proposalStatus, proposalTitle } from "./proposal-words";

const format = formatters("en", "USD");
const db = testDatabases();
let circle: CircleSnapshot;

beforeAll(async () => {
  const visitor = await visitorWithCircle(db);
  circle = await snapshotFor(db, visitor.userId, visitor.circleId);
});

describe("the words for an approval plan", () => {
  it("say how each of November's bills will be approved", async () => {
    const english = await getDictionary("en");
    const labels = upcomingBills(circle).map((bill) => (bill.plan ? fill(english.dashboard.common.planLabels[planLabel(bill.plan)], { parent: "Rose" }) : null));
    expect(labels).toEqual(["Pays itself under a standing rule", "Pays itself under a standing rule", "Rose decides", "Rose decides"]);
  });

  it("cover every outcome the approval engine can give", () => {
    expect(planLabel({ outcome: "refused", reason: "above_ceiling" })).toBe("refused");
    expect(planLabel({ outcome: "paused", until: new Date(0) })).toBe("paused");
    expect(planLabel({ outcome: "standing_rule", ruleId: "r", agreementVersion: 1 })).toBe("standing");
    const slot = (reason: "parent_decides" | "organizer" | "second_approval") => ({ reason, roles: [] });
    const pending = { outcome: "needs_approval" as const, payeeMemberId: null, announceToCircle: false, expiresAt: new Date(0) };
    expect(planLabel({ ...pending, slots: [slot("organizer"), slot("second_approval")] })).toBe("organizerAndSecond");
    expect(planLabel({ ...pending, slots: [slot("parent_decides"), slot("second_approval")] })).toBe("parentAndSecond");
  });
});

describe("the words for a proposal", () => {
  it("tell Elena when it is her turn, and whose yes it waits for when it is not", async () => {
    const english = await getDictionary("en");
    const names = circleNames(circle, english);
    const statuses = waitingProposals(circle).map((view) => [proposalTitle(english, names, view.proposal, "October 2026"), proposalStatus(english, names, format, view).text]);
    expect(Object.fromEntries(statuses)).toEqual({
      "Stairlift repair": "Your yes is needed",
      "Amara’s visits this week": "Waiting for Rose",
      "October 2026 settlement for Ana": "Your yes is needed",
      "October 2026 settlement for Elena": "Waiting for Rose",
    });
  });

  it("fall back to who is paid for a purpose the dictionary does not know", async () => {
    const english = await getDictionary("en");
    const first = circle.proposals.find((each) => each.purpose === "stairlift");
    if (!first) throw new Error("No proposal");
    expect(proposalTitle(english, circleNames(circle, english), { ...first, purpose: "somethingNew" }, "October 2026")).toBe("Ridgeway Stairlifts");
  });
});

describe("the words for a ledger entry", () => {
  it.each(locales)("describe every entry of the circle in %s, with no slot left unfilled", async (locale) => {
    const dictionary = await getDictionary(locale);
    const names = circleNames(circle, dictionary);
    for (const view of recordEntries(circle)) {
      const text = describeEntry(dictionary, names, view);
      expect(text).not.toMatch(/[{}]/);
      expect(text.trim()).not.toBe("");
      // A row ID never reaches a person: every subject resolves to a name.
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
  });

  it("say who paid what in English, with the names the circle gave them", async () => {
    const english = await getDictionary("en");
    const names = circleNames(circle, english);
    const lines = recordEntries(circle).map((view) => describeEntry(english, names, view));
    expect(lines).toContain("Marcus’s contribution");
    expect(lines).toContain("Elena’s receipt: Pharmacy");
    expect(lines).toContain("Amara: paid");
    expect(lines).toContain("Northfield Gas: paid");
    expect(lines).toContain("Pharmacy order for Rose");
  });
});
