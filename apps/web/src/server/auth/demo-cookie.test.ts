import { describe, expect, it } from "vitest";

import { DEMO_COOKIE, clearedDemoCookie, demoCookie } from "./demo-cookie";

describe("the demo visitor's cookie", () => {
  it("is out of reach of page scripts and bound to this exact origin", () => {
    const cookie = demoCookie("token");
    expect(cookie.name).toBe(DEMO_COOKIE);
    expect(DEMO_COOKIE.startsWith("__Host-")).toBe(true);
    expect(cookie.options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  });

  it("lasts as long as the demo session it carries, and expires at once when cleared", () => {
    expect(demoCookie("token").options.maxAge).toBe(14 * 24 * 60 * 60);
    expect(clearedDemoCookie().options.maxAge).toBe(0);
  });
});
