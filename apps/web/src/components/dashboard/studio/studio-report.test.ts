import { describe, expect, it } from "vitest";

import type { StudioData } from "@/content/circle/studio-data";
import english from "@/i18n/dictionaries/en.json" with { type: "json" };
import { formatters } from "@/lib/format";

import { studioReport, studioWidgets } from "./studio-report";
import { studioFieldIds, studioSources, writeMoney, writeMonth } from "./studio-sources";

const copy = english.dashboard.studio;
const format = formatters("en", "USD");
const data: StudioData = {
  currency: "USD",
  ledger: [
    {
      id: "e1",
      day: "2026-10-03",
      month: "2026-10",
      kind: "Contribution",
      person: "Elena",
      category: "No category",
      amountCents: 30_000,
      inCents: 30_000,
      outCents: 0,
      feeCents: 1_079,
      caregiverPayCents: 0,
      caregiver: "",
      proof: "Simulated",
      simulated: true,
      paypalVerified: false,
      paypalId: "",
    },
  ],
  fairness: [{ month: "2026-10", member: "Elena", shareBps: 5_000, shareIndex: 0, givenCents: 30_000, agreedCents: 46_200, positionCents: -16_200 }],
};

describe("the studio's opening page", () => {
  it("refers only to fields the record's two tables define", () => {
    const fields = studioFieldIds(studioSources(data, copy, format));
    const referred = studioWidgets(copy).flatMap(({ state }) => Object.values(state.dataMapping as Record<string, { id: string }[]>).flat().map((reference) => reference.id));
    expect(referred.length).toBeGreaterThan(10);
    for (const id of referred) expect(fields).toContain(id);
  });

  it("sums money and never averages it, so every figure is whole cents", () => {
    const aggregations = studioWidgets(copy).flatMap(({ state }) => Object.values(state.dataMapping as Record<string, { id: string; aggregation?: string }[]>).flat()).flatMap((reference) => (reference.aggregation ? [reference.aggregation] : []));
    expect(new Set(aggregations)).toEqual(new Set(["sum"]));
  });

  it("lays its widgets out on AG Studio's 24 columns without overlap, Kin's two first", () => {
    const widgets = studioWidgets(copy);
    expect(widgets.slice(0, 2).map(({ state }) => state.type)).toEqual(["kin-paypal-verified", "kin-fairness-gap"]);
    for (const { layout } of widgets) expect(layout.xTrack + layout.xSpan).toBeLessThanOrEqual(24);
    for (const [index, a] of widgets.entries()) {
      for (const b of widgets.slice(index + 1)) {
        const apart = a.layout.xTrack + a.layout.xSpan <= b.layout.xTrack || b.layout.xTrack + b.layout.xSpan <= a.layout.xTrack || a.layout.yTrack + a.layout.ySpan <= b.layout.yTrack || b.layout.yTrack + b.layout.ySpan <= a.layout.yTrack;
        expect(apart, `${a.id} and ${b.id} overlap`).toBe(true);
      }
    }
    expect(studioReport(copy, true).pages[0]?.widgets).toHaveProperty("fairness");
    expect(studioReport(copy, false).panels?.["ai"]).toEqual({ collapsed: true });
  });
});

describe("the studio's fields", () => {
  it("write money with Kin's one formatter, from whole cents", () => {
    expect(writeMoney(format)(1_079)).toBe(format.money(1_079));
    expect(writeMoney(format)(1_079)).toBe("$10.79");
    // A chart's axis tick between two cents is drawn to the nearest cent.
    expect(writeMoney(format)(1_079.4)).toBe("$10.79");
  });

  it("read a month as people say it, while it sorts as time does", () => {
    expect(writeMonth(format)("2026-10")).toBe("October 2026");
    expect(writeMonth(format)("not a month")).toBe("not a month");
  });
});
