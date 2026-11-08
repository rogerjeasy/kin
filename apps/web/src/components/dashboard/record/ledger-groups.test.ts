import { describe, expect, it } from "vitest";

import { arrangeLedger, compareGroups, groupHeaders } from "./ledger-groups.ts";
import type { LedgerGridRow, LedgerRow } from "./ledger-row.ts";

type Node = { readonly data: LedgerGridRow };
const read = (node: Node) => node.data;

function entry(id: string, over: Partial<LedgerRow> & { cents: number; flow: LedgerRow["flow"] }): Node {
  const row = {
    rowKind: "entry",
    id,
    isoDay: "2026-10-01",
    person: { key: "marcus", label: "Marcus" },
    category: { key: "groceries", label: "Groceries" },
    month: { key: "2026-10", label: "October 2026" },
    ...over,
  } as LedgerRow;
  return { data: row };
}

const rows = (nodes: Node[]) => nodes.map((node) => node.data as LedgerRow);

const october = { month: { key: "2026-10", label: "October 2026" } };
const september = { month: { key: "2026-09", label: "September 2026" } };

const entries = [
  entry("a", { cents: 40_913, flow: "in", ...october }),
  entry("b", { cents: 12_600, flow: "out", ...october }),
  entry("c", { cents: 5_000, flow: "in", ...september }),
  entry("d", { cents: 5_000, flow: "out", ...september }),
  entry("e", { cents: 8_000, flow: "none", ...september }),
];

const headers = (by: "person" | "category" | "month"): Node[] => groupHeaders(rows(entries), by).map((data) => ({ data }));
const compare = compareGroups("month", "en");

describe("groupHeaders", () => {
  it("makes one heading per group, whatever the number of entries", () => {
    expect(groupHeaders(rows(entries), "month").map((header) => header.key)).toEqual(["2026-10", "2026-09"]);
    expect(groupHeaders(rows(entries), "person")).toHaveLength(1);
  });
});

describe("arrangeLedger by month", () => {
  const result = arrangeLedger([...entries, ...headers("month")], "month", read, compare);

  it("puts each heading before its entries, newest month first, entries in the order they came", () => {
    expect(result.nodes.map((node) => (node.data.rowKind === "group" ? `# ${node.data.key}` : node.data.id))).toEqual(["# 2026-10", "a", "b", "# 2026-09", "c", "d", "e"]);
  });

  it("subtotals each group from integer cents", () => {
    expect(result.sections.get("2026-10")).toEqual({ count: 2, inCents: 40_913, outCents: 12_600, netCents: 28_313 });
    expect(result.sections.get("2026-09")).toEqual({ count: 3, inCents: 5_000, outCents: 5_000, netCents: 0 });
  });

  it("totals the whole view so that the groups add up to it", () => {
    const net = [...result.sections.values()].reduce((sum, section) => sum + section.netCents, 0);
    expect(result.overall.netCents).toBe(net);
    expect(result.overall).toEqual({ count: 5, inCents: 45_913, outCents: 17_600, netCents: 28_313 });
  });
});

describe("arrangeLedger with a filter in force", () => {
  it("drops the heading of a group with no entry left, and keeps the rest", () => {
    const shown = entries.filter((node) => (node.data as LedgerRow).month.key === "2026-09");
    const result = arrangeLedger([...shown, ...headers("month")], "month", read, compare);
    expect(result.nodes.map((node) => node.data.id)).toEqual(["group:month:2026-09", "c", "d", "e"]);
    expect(result.sections.has("2026-10")).toBe(false);
  });

  it("is empty, and totals zero, when nothing is left", () => {
    const result = arrangeLedger(headers("month"), "month", read, compare);
    expect(result.nodes).toEqual([]);
    expect(result.overall).toEqual({ count: 0, inCents: 0, outCents: 0, netCents: 0 });
  });
});

describe("arrangeLedger with a reversal", () => {
  it("nets a reversal against the entry it cancels inside their group", () => {
    const pair = [entry("x", { cents: 7_550, flow: "in" }), entry("x-undo", { cents: 7_550, flow: "out" })];
    const result = arrangeLedger([...pair, ...headers("person").slice(0, 1)], "person", read, compareGroups("person", "en"));
    expect(result.sections.get("marcus")).toEqual({ count: 2, inCents: 7_550, outCents: 7_550, netCents: 0 });
  });

  it("shows a negative net as a negative number of cents", () => {
    const result = arrangeLedger([entry("y", { cents: 300, flow: "out" })], "none", read, compare);
    expect(result.overall.netCents).toBe(-300);
  });
});

describe("arrangeLedger with no grouping", () => {
  it("leaves the order alone and drops any heading", () => {
    const result = arrangeLedger([...headers("month"), ...entries], "none", read, compare);
    expect(result.nodes.map((node) => node.data.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.sections.size).toBe(0);
  });
});

describe("arrangeLedger never loses an entry", () => {
  it("keeps entries whose group has no heading, last", () => {
    const result = arrangeLedger([...entries, ...headers("month").slice(0, 1)], "month", read, compare);
    expect(result.nodes.map((node) => node.data.id)).toEqual(["group:month:2026-10", "a", "b", "c", "d", "e"]);
    expect(result.sections.get("2026-09")?.count).toBe(3);
  });
});

describe("compareGroups", () => {
  const person = (label: string) => ({ rowKind: "group" as const, id: label, groupBy: "person" as const, key: label, label });

  it("orders people alphabetically in the reader's language, ignoring accents and case", () => {
    const sorted = [person("Élodie"), person("amara"), person("Zoë"), person("Elena")].toSorted(compareGroups("person", "fr"));
    expect(sorted.map((group) => group.label)).toEqual(["amara", "Elena", "Élodie", "Zoë"]);
  });

  it("orders months newest first", () => {
    const month = (key: string) => ({ rowKind: "group" as const, id: key, groupBy: "month" as const, key, label: key });
    expect([month("2026-08"), month("2026-10"), month("2025-12")].toSorted(compareGroups("month", "en")).map((group) => group.key)).toEqual(["2026-10", "2026-08", "2025-12"]);
  });
});
