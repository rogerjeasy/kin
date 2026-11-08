import { snapshotFor, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { SHIFT_CALL_STATES } from "@kin/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import { circleNames } from "@/content/circle/names";
import { shiftViews, type ShiftView } from "@/content/circle/shift-views";
import { shiftWeek } from "@/content/circle/shift-week";
import { getDictionary } from "@/i18n/dictionary";
import { formatters } from "@/lib/format";

import { ShiftExtras, type ShiftExtrasScope } from "./shift-extras";

const db = testDatabases();
const english = await getDictionary("en");
const format = formatters("en", "USD", "America/New_York");
let circle: VisitorCircle;

beforeAll(async () => {
  circle = await visitorWithCircle(db);
});

async function viewOf(overrides: Partial<ShiftView["shift"]>) {
  const snapshot = await snapshotFor(db, circle.userId, circle.circleId);
  const view = shiftViews(snapshot, shiftWeek(snapshot, "2026-10-30")).find((each) => each.shift.kind === "aide");
  if (view === undefined) throw new Error("The demo has no aide shift this week");
  return { snapshot, view: { ...view, canLink: false, canHearCall: false, shift: { ...view.shift, ...overrides } } };
}

const scope = (snapshot: Awaited<ReturnType<typeof viewOf>>["snapshot"], fairnessHref: string | null): ShiftExtrasScope => ({
  locale: "en",
  timezone: snapshot.circle.timezone,
  viewerMemberId: snapshot.viewer.memberId,
  textingOn: false,
  fairnessHref,
  links: english.dashboard.shiftLinks,
  calls: english.dashboard.shiftCalls,
});

async function render(overrides: Partial<ShiftView["shift"]>, fairnessHref: string | null = "/dashboard/fairness"): Promise<string> {
  const { snapshot, view } = await viewOf(overrides);
  const names = circleNames(snapshot, english);
  return renderToStaticMarkup(createElement(ShiftExtras, { view, scope: scope(snapshot, fairnessHref), copy: english.dashboard.shifts, format, names }));
}

describe("what a shift card says of Kin's call", () => {
  it("says nothing when there was no call, and each state in words that blame no one", async () => {
    expect(await render({ callState: null })).toBe("");
    for (const state of SHIFT_CALL_STATES) {
      const html = await render({ callState: state });
      expect(html, state).toContain("Rose");
      expect(html, state).toContain("Kin");
    }
    expect(await render({ callState: "calling" })).toContain("Kin is calling Rose.");
    expect(await render({ callState: "no_answer" })).toContain("Kin called Rose and got no answer. Kin may try once more.");
    const declined = await render({ callState: "declined" });
    expect(declined).toContain("Rose said the visit did not happen. Nothing is paid, and the family can look into it.");
    expect(declined).not.toMatch(/lied|false|wrong|fraud/i);
  });
});

describe("what a shift card says of care time that counted", () => {
  it("says what a credited visit counted for, from its own record, with a way to the fairness page", async () => {
    const html = await render({ state: "credited", kind: "visit", creditedMinutes: 45, creditedCents: 1500 });
    // The organizer did not do the visit, so the credit is said to be the visitor's.
    expect(html).toContain("Counted as care time: 45 min, worth $15.00 toward the share of ");
    expect(html).toContain('href="/dashboard/fairness"');
    expect(html).toContain("See the fairness page");
  });

  it("leaves the link out for a viewer who may not see the family's money, and says nothing when the amount is unknown", async () => {
    expect(await render({ creditedMinutes: 45, creditedCents: 1500 }, null)).not.toContain("href=");
    expect(await render({ creditedMinutes: 45, creditedCents: null })).toBe("");
  });

  it("says it is the viewer's own share when the visit is theirs", async () => {
    const { snapshot, view } = await viewOf({ creditedMinutes: 90, creditedCents: 3000 });
    const mine = { ...scope(snapshot, null), viewerMemberId: view.shift.memberId };
    const html = renderToStaticMarkup(createElement(ShiftExtras, { view, scope: mine, copy: english.dashboard.shifts, format, names: circleNames(snapshot, english) }));
    expect(html).toContain("Counted as care time: 1 h 30 min, worth $30.00 toward your share.");
  });
});
