import { describe, expect, it } from "vitest";

import { dashboardNav, dashboardRoutes, phoneNav, sectionOf } from "./dashboard-routes";

describe("the circle's screens", () => {
  it("each have their own address under /dashboard", () => {
    const paths = Object.values(dashboardRoutes);

    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.every((path) => path.startsWith("/dashboard"))).toBe(true);
  });

  it("are all in the sidebar, and the phone bar holds five of them", () => {
    expect(dashboardNav.toSorted()).toEqual(Object.keys(dashboardRoutes).toSorted());
    expect(phoneNav).toHaveLength(5);
    expect(phoneNav.every((section) => dashboardNav.includes(section))).toBe(true);
  });

  it("are recognised from the segment under /dashboard", () => {
    expect(sectionOf(null)).toBe("overview");
    expect(sectionOf("approvals")).toBe("approvals");
    expect(sectionOf("circle")).toBe("circle");
    expect(sectionOf("nowhere")).toBe("overview");
  });
});
