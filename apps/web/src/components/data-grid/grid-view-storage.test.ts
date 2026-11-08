import { describe, expect, it } from "vitest";

import { parseView, pickGridState, readView, serializeView, writeView, type ViewStorage } from "./grid-view-storage.ts";

const memory = (): ViewStorage & { items: Map<string, string> } => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
};

const failing: ViewStorage = {
  getItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("full", "QuotaExceededError");
  },
};

const view = {
  grid: {
    sort: { sortModel: [{ colId: "cents", sort: "desc" as const }] },
    filter: { filterModel: { text: { filterType: "text", type: "contains", filter: "gas" } } },
    columnVisibility: { hiddenColIds: ["source"] },
    columnOrder: { orderedColIds: ["isoDay", "text", "cents"] },
  },
  query: "marcus",
  groupBy: "month",
};

describe("a stored grid view", () => {
  it("is read back as it was written", () => {
    const storage = memory();
    expect(writeView(storage, "k", view)).toBe(true);
    expect(readView(storage, "k")).toEqual({ version: 1, ...view });
  });

  it("is dropped to its parts a grid may keep: no scroll, focus, selection or widths", () => {
    const picked = pickGridState({ ...view.grid, scroll: { top: 90, left: 0 }, focusedCell: { colId: "text", rowIndex: 2 }, rowSelection: ["a"], columnSizing: { columnSizingModel: [{ colId: "text", width: 900 }] } });
    expect(Object.keys(picked).toSorted()).toEqual(["columnOrder", "columnVisibility", "filter", "sort"]);
  });

  it("starts as built when nothing is stored", () => {
    expect(readView(memory(), "k")).toBeNull();
    expect(readView(null, "k")).toBeNull();
  });

  it.each(["not json", "[]", "null", '{"version":2}', '{"grid":{}}'])("starts as built for the stored text %j", (text) => {
    expect(parseView(text)).toBeNull();
  });

  it("ignores parts with the wrong shape instead of passing them to the grid", () => {
    const parsed = parseView(JSON.stringify({ version: 1, grid: { sort: { sortModel: [{ colId: 3, sort: "up" }] }, columnVisibility: { hiddenColIds: "source" }, filter: { filterModel: "x" }, columnOrder: null }, query: 9, groupBy: 4 }));
    expect(parsed).toEqual({ version: 1, grid: { sort: { sortModel: [] } }, query: "", groupBy: "none" });
  });

  it("keeps a stored search to a sensible length", () => {
    const parsed = parseView(serializeView({ grid: {}, query: "x".repeat(5_000), groupBy: "none" }));
    expect(parsed?.query).toHaveLength(200);
  });

  it("works without storage: reads as nothing, saves nothing, never throws", () => {
    expect(readView(failing, "k")).toBeNull();
    expect(writeView(failing, "k", view)).toBe(false);
    expect(writeView(null, "k", view)).toBe(false);
  });
});
