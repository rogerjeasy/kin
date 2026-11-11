import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isAskKinTool } from "./ask-kin-tools.ts";

type Case = { name: string; must?: string[]; mustNot?: string[]; minTools?: number; injected?: string[] };
type Suite = { record: Record<string, unknown>; injected: Record<string, unknown>; claims: Record<string, unknown>; cases: Case[] };

const suite = JSON.parse(readFileSync(new URL("../../evals/agent.json", import.meta.url), "utf8")) as Suite;

/** The Ask Kin evaluation set is read by scripts/eval-agent.ts, which calls the paid model; this checks its shape for free. */
describe("the Ask Kin evaluation set", () => {
  it("names only Ask Kin's own tools, and has a result for every injected one", () => {
    for (const each of suite.cases) {
      for (const tool of [...(each.must ?? []), ...(each.mustNot ?? []), ...(each.injected ?? [])]) expect(isAskKinTool(tool), `${each.name}: ${tool}`).toBe(true);
      for (const tool of each.injected ?? []) expect(suite.injected[tool], `${each.name}: ${tool}`).toBeDefined();
    }
    expect(Object.keys(suite.record).every(isAskKinTool)).toBe(true);
  });

  it("holds at least five multi-step cases, each requiring the tools it counts", () => {
    const multi = suite.cases.filter((each) => (each.minTools ?? 0) >= 2);
    expect(multi.length).toBeGreaterThanOrEqual(5);
    for (const each of multi) expect(new Set(each.must).size, each.name).toBeGreaterThanOrEqual(each.minTools ?? 0);
    expect(multi.some((each) => (each.injected ?? []).length >= 2)).toBe(true);
  });

  it("has unique case names, so each result can be found again", () => {
    expect(new Set(suite.cases.map((each) => each.name)).size).toBe(suite.cases.length);
  });
});
