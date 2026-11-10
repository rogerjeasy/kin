import { describe, expect, it } from "vitest";

import { dashboardNav, dashboardRoutes, phoneSections, sectionOf } from "./dashboard-routes";

describe("the circle's screens", () => {
  it("each have their own address under /dashboard", () => {
    const paths = Object.values(dashboardRoutes);

    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.every((path) => path.startsWith("/dashboard"))).toBe(true);
  });

  it("are all in the sidebar, and the phone bar holds the first five a role may open, leaving the record and the circle to the menu", () => {
    expect(dashboardNav.toSorted()).toEqual(Object.keys(dashboardRoutes).toSorted());
    expect(phoneSections(dashboardNav)).toEqual(["overview", "shifts", "approvals", "bills", "fairness"]);
    expect(phoneSections(["listen", "overview", "shifts", "approvals", "bills", "fairness", "record", "circle"])).toEqual(["listen", "overview", "shifts", "approvals", "bills"]);
    expect(phoneSections(["shifts", "bills", "circle"])).toEqual(["shifts", "bills"]);
  });

  it("are recognised from the segment under /dashboard", () => {
    expect(sectionOf(null)).toBe("overview");
    expect(sectionOf("approvals")).toBe("approvals");
    expect(sectionOf("circle")).toBe("circle");
    expect(sectionOf("nowhere")).toBe("overview");
  });
});
