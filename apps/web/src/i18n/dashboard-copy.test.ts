import { describe, expect, it } from "vitest";

import { dashboardNav } from "../content/dashboard-routes";
import { getDictionary } from "./dictionary";
import { locales } from "./locales";

// The phone's bottom bar holds five labels side by side at 320 pixels.
const MAX_TAB_LENGTH = 11;

describe.each(locales)("the %s copy of the circle's screens", (locale) => {
  it("names each screen the same in its tab, its heading and its title", async () => {
    const { dashboard } = await getDictionary(locale);

    for (const section of dashboardNav) {
      const tab = dashboard.shell.nav[section];
      // The overview's heading greets the person, so only its title must match.
      if (section !== "overview") expect(dashboard[section].title, section).toBe(tab);
      expect(dashboard.meta[section].title.split(" · ")[0], section).toBe(tab);
      expect([...tab].length, section).toBeLessThanOrEqual(MAX_TAB_LENGTH);
    }
  });

  it("labels roles without slash or star forms, since they sit beside women and men alike", async () => {
    const { dashboard } = await getDictionary(locale);

    for (const label of [...Object.values(dashboard.common.roles), dashboard.common.you]) {
      expect(label).not.toMatch(/[/*·]/);
    }
  });
});
