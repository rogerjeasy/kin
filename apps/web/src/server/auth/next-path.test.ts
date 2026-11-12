import { describe, expect, it } from "vitest";

import { isDashboardPage, localeOfPath, safeNextPath, signInPath } from "./next-path";

describe("where to go after signing in", () => {
  it.each(["/dashboard", "/dashboard/approvals", "/fr/dashboard/record", "/ar/dashboard"])("keeps the circle's own screen %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    ["another site", "https://evil.example/dashboard"],
    ["a protocol-relative address", "//evil.example/dashboard"],
    ["a backslash trick", "/\\evil.example/dashboard"],
    ["a page outside the circle", "/pricing"],
    ["a look-alike path", "/dashboardx"],
    ["a script", "javascript:alert(1)"],
    ["nothing", null],
  ])("falls back to the overview for %s", (_case, path) => {
    expect(safeNextPath(path)).toBe("/dashboard");
  });

  it("drops any query or fragment carried along", () => {
    expect(safeNextPath("/dashboard/bills?x=1#y")).toBe("/dashboard/bills");
  });

  it("keeps the query of the OAuth consent screen only, which is the client's request and is checked again there", () => {
    expect(safeNextPath("/fr/dashboard/circle/connections/authorize?client_id=kin_cli_x&state=s#frag")).toBe("/fr/dashboard/circle/connections/authorize?client_id=kin_cli_x&state=s");
    expect(safeNextPath("//evil.example/dashboard/circle/connections/authorize?x=1")).toBe("/dashboard");
    expect(safeNextPath("/dashboard/circle/connections?x=1")).toBe("/dashboard/circle/connections");
  });
});

describe("the circle's screens", () => {
  it("are /dashboard and everything under it, in any language", () => {
    expect(isDashboardPage("/dashboard")).toBe(true);
    expect(isDashboardPage("/de/dashboard/fairness")).toBe(true);
    expect(isDashboardPage("/sign-in")).toBe(false);
    expect(isDashboardPage("/dashboards")).toBe(false);
  });
});

describe("the sign-in page to send someone to", () => {
  it("is in the language of the screen they wanted, and remembers it", () => {
    expect(localeOfPath("/he/dashboard")).toBe("he");
    expect(signInPath("/fr/dashboard/bills")).toBe("/fr/sign-in?next=%2Ffr%2Fdashboard%2Fbills");
    expect(signInPath("/dashboard", "unavailable")).toBe("/sign-in?next=%2Fdashboard&problem=unavailable");
  });
});
