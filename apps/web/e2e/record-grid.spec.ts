import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { fill } from "../src/i18n/template";
import { startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { maybeScreenshot } from "./support/screenshot";
import { laptop, phone, viewports } from "./support/viewports";

const { dashboard, dataGrid } = english;
const { record } = dashboard;

const PAGES = [
  { name: "the record", path: "/dashboard/record" },
  { name: "the statement", path: "/dashboard/record/statement" },
  { name: "the audit trail", path: "/dashboard/record/audit/view" },
] as const;

/** The entries of Rose's demo circle, and what they did to the pool: $924.00 in, $530.00 out. */
const ENTRIES = 19;
const NET = "$394.00";

const toolbar = (page: Page) => ({
  search: page.getByRole("searchbox", { name: dataGrid.toolbar.search }),
  group: page.getByLabel(dataGrid.toolbar.group),
  reset: page.getByRole("button", { name: dataGrid.toolbar.reset }),
  download: page.getByRole("button", { name: dataGrid.toolbar.export }),
  columns: page.getByRole("button", { name: dataGrid.toolbar.columns }),
});
const gridOf = (page: Page) => page.getByRole("region", { name: record.grid.label });
const entryRows = (page: Page) => gridOf(page).locator(".ag-grid-scrolling-rows .ag-row:not(.ag-full-width-row)");
// The sentence under the toolbar; the same words are also read aloud from a hidden live region.
const visibleCount = (page: Page, n: number) => page.locator("p:not(.sr-only)", { hasText: shown(n) });
const shown = (n: number, total = ENTRIES) => fill(dataGrid.toolbar.shown, { shown: String(n), total: String(total) });

for (const viewport of viewports) {
  test.describe(`at ${viewport.width}×${viewport.height} (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const { name, path } of PAGES) {
      test(`${name} fits, with its grid on a wide screen and its cards on a phone`, async ({ page }) => {
        await startDemo(page);
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const wide = viewport.width >= 768;
        await expect(page.getByRole(wide ? "grid" : "list", { name: record.grid.label }).first()).toBeVisible();
        await maybeScreenshot(page, name.replaceAll(" ", "-"));
        await expectNoHorizontalOverflow(page);
      });
    }
  });
}

test.describe("the record grid on a laptop", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });

  test("totals what it shows, from the record's own cents", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record");
    await expect(entryRows(page)).toHaveCount(ENTRIES);
    const total = gridOf(page).locator(".ag-grid-pinned-bottom-rows");
    await expect(total).toContainText(fill(dataGrid.totals.entries, { count: String(ENTRIES) }));
    await expect(total).toContainText(`${dataGrid.totals.net}: ${NET}`);
    await expect(visibleCount(page, ENTRIES)).toBeVisible();
  });

  test("is reached with the Tab key, read with the arrow keys and filtered by typing", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record");
    await expect(entryRows(page)).toHaveCount(ENTRIES);

    await toolbar(page).reset.focus();
    await page.keyboard.press("Tab");
    const insideGrid = () => page.evaluate(() => document.activeElement?.closest(".ag-root") !== null);
    expect(await insideGrid()).toBe(true);

    // Down from the headings to the first entry, then along the entries: the panel beside follows.
    const detail = page.getByRole("region", { name: record.grid.detailTitle });
    await entryRows(page).first().locator("[role='gridcell']").nth(1).click();
    const first = await detail.locator("p").first().textContent();
    await page.keyboard.press("ArrowDown");
    await expect(detail.locator("p").first()).not.toHaveText(first ?? "");

    // Typing in the entry column's floating filter narrows the rows and says so.
    await gridOf(page).getByRole("textbox", { name: `${record.columns.entry} Filter input` }).fill("gas");
    await expect(entryRows(page)).toHaveCount(2);
    await expect(visibleCount(page, 2)).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: shown(2) })).toHaveCount(1);
  });

  test("searches, and resets to everything", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record");
    await toolbar(page).search.fill("amara");
    await expect(entryRows(page)).toHaveCount(2);
    await toolbar(page).reset.click();
    await expect(entryRows(page)).toHaveCount(ENTRIES);
    await expect(toolbar(page).search).toHaveValue("");
  });

  test("filters by amount typed as money, to the cent", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record");
    const amount = gridOf(page).getByRole("textbox", { name: `${record.columns.amount} Filter input` });
    await amount.fill("264");
    await expect(entryRows(page)).toHaveCount(2);
    await amount.fill("264.01");
    await expect(gridOf(page).locator(".ag-overlay")).toContainText(dataGrid.localeText.noMatchingRows);
  });

  test("groups by month with a subtotal on each heading, and drops a heading with nothing under it", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record");
    await toolbar(page).group.selectOption("month");
    const headings = gridOf(page).locator(".ag-grid-scrolling-rows .ag-full-width-row");
    await expect(page.getByRole("status").filter({ hasText: fill(dataGrid.live.grouped, { group: dataGrid.toolbar.groups.month }) })).toHaveCount(1);
    await expect(gridOf(page).locator(".ag-grid-scrolling-rows .ag-full-width-row").first()).toContainText("November 2026");
    await expect(entryRows(page)).toHaveCount(ENTRIES);
    // The subtotals add up to the total.
    await expect(headings.first()).toContainText(dataGrid.totals.net);
    await toolbar(page).search.fill("nov");
    await expect(gridOf(page).locator(".ag-grid-scrolling-rows .ag-full-width-row")).toHaveCount(1);
  });

  test("chooses its columns, and remembers them with the search and grouping after a reload", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record");
    await toolbar(page).columns.click();
    await page.getByRole("menuitemcheckbox", { name: dataGrid.columns.entryId }).click();
    await page.keyboard.press("Escape");
    await expect(gridOf(page).getByRole("columnheader", { name: dataGrid.columns.entryId })).toBeVisible();
    await toolbar(page).search.fill("gas");
    await toolbar(page).group.selectOption("person");

    await page.reload();
    await expect(toolbar(page).search).toHaveValue("gas");
    await expect(toolbar(page).group).toHaveValue("person");
    await expect(gridOf(page).getByRole("columnheader", { name: dataGrid.columns.entryId })).toBeVisible();
  });

  test("totals the rows ticked, in a live region", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record");
    const boxes = gridOf(page).locator(".ag-selection-checkbox input");
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await expect(page.getByRole("status").filter({ hasText: /^Selected: 2\./ })).toBeVisible();
  });

  test("copies an entry's ID", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await startDemo(page);
    await page.goto("/dashboard/record");
    await entryRows(page).first().locator("[role='gridcell']").nth(1).click();
    await page.getByRole("button", { name: dataGrid.detail.copyId }).click();
    await expect(page.getByText(dataGrid.detail.copied)).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/[0-9a-f-]{8,}/);
  });

  test("downloads the view it shows as a CSV: a heading, a byte order mark, exact decimals and a total", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record");
    await expect(entryRows(page)).toHaveCount(ENTRIES);
    const download = page.waitForEvent("download");
    await toolbar(page).download.click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^kin-record-view-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await readFile((await file.path()) ?? "", "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split("\r\n");
    expect(lines[0]).toBe("Kin record: Rose's circle");
    expect(lines[1]).toMatch(/^Generated on \d{4}-\d{2}-\d{2}$/);
    expect(lines[2]).toBe(`Entries in this file: ${ENTRIES} of ${ENTRIES}`);
    expect(lines[3]).toContain(`"${record.columns.date}","${record.columns.entry}"`);
    expect(lines.find((line) => line.includes("Marcus’s contribution"))).toContain('"424.00","424.00"');
    expect(lines.filter((line) => line.includes("Marcus’s contribution"))).toHaveLength(1);
    // The closing total: in minus out, from cents.
    expect(lines.at(-1)).toMatch(/^,Total,.*,394\.00$/);
    expect(lines.slice(4, -1)).toHaveLength(ENTRIES);
  });

  test("downloads only what the search leaves", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record");
    await toolbar(page).search.fill("gas");
    await expect(entryRows(page)).toHaveCount(2);
    const download = page.waitForEvent("download");
    await toolbar(page).download.click();
    const text = await readFile(((await (await download).path()) ?? ""), "utf8");
    const lines = text.slice(1).split("\r\n");
    expect(lines[2]).toBe(`Entries in this file: 2 of ${ENTRIES}`);
    expect(lines.slice(4, -1)).toHaveLength(2);
    expect(lines.at(-1)).toMatch(/Total/);
  });

  test("still works when the browser refuses to store anything", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    });
    await startDemo(page);
    await page.goto("/dashboard/record");
    await expect(entryRows(page)).toHaveCount(ENTRIES);
    await toolbar(page).search.fill("gas");
    await expect(entryRows(page)).toHaveCount(2);
  });

  test("reads right to left in Arabic and Hebrew with the grid's own words", async ({ page }) => {
    await startDemo(page);
    await page.goto("/ar/dashboard/record");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator(".ag-rtl").first()).toBeAttached();
    await expect(page.getByRole("searchbox")).toBeVisible();
    await page.goto("/he/dashboard/record");
    await expect(page.locator(".ag-rtl").first()).toBeAttached();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("the record on a phone", () => {
  test.use({ viewport: { width: phone.width, height: phone.height } });

  test("has the same search, grouping, totals and download over its cards", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record");
    const cards = page.locator("details");
    await expect(cards).toHaveCount(ENTRIES);
    await toolbar(page).search.fill("gas");
    await expect(cards).toHaveCount(2);
    await toolbar(page).search.fill("");
    await toolbar(page).group.selectOption("month");
    await expect(page.getByRole("list", { name: record.grid.label }).getByText("November 2026").first()).toBeVisible();
    await expect(page.getByText(`${dataGrid.totals.net}: ${NET}`).last()).toBeVisible();
    const download = page.waitForEvent("download");
    await toolbar(page).download.click();
    expect((await download).suggestedFilename()).toMatch(/^kin-record-view-/);
    await expectNoHorizontalOverflow(page);
  });

  test("shows an entry's proof and copies its ID from the card", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record");
    await page.locator("details summary").first().click();
    await expect(page.locator("details").first().getByText(dataGrid.detail.reference)).toBeVisible();
    await expect(page.locator("details").first().getByRole("button", { name: dataGrid.detail.copyId })).toBeVisible();
  });
});

test.describe("the audit trail and the statement", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });

  test("the audit trail opens on the proof columns and shows that the entries balance", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record/audit/view");
    const grid = gridOf(page);
    await expect(grid.getByRole("columnheader", { name: dataGrid.columns.entryId })).toBeVisible();
    await expect(grid.getByRole("columnheader", { name: dataGrid.columns.reference })).toBeVisible();
    await expect(grid.locator(".ag-grid-pinned-bottom-rows")).toContainText(dataGrid.totals.balanced);
  });

  test("the statement's year in review is a grid with its total pinned, and its entries a grid under it", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record/statement");
    const year = page.getByRole("region", { name: /^Month by month in / });
    await expect(year.locator(".ag-grid-pinned-bottom-rows")).toBeVisible();
    await expect(year.getByRole("columnheader")).toHaveCount(4);
    await expect(page.getByRole("region", { name: record.grid.label })).toBeVisible();
  });

  test("print lays out every row and drops the controls", async ({ page }) => {
    await startDemo(page);
    await page.goto("/dashboard/record/audit/view");
    await expect(entryRows(page)).toHaveCount(ENTRIES);
    await page.emulateMedia({ media: "print" });
    await expect(toolbar(page).search).toBeHidden();
    await expect(gridOf(page).locator(".ag-root")).toHaveClass(/ag-layout-print/);
    await expect(entryRows(page)).toHaveCount(ENTRIES);
    await expect(gridOf(page).getByText("Marcus’s contribution")).toBeVisible();
  });
});
