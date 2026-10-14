import { expect, type Page } from "@playwright/test";

/**
 * The one shared check that a screen fits its viewport. It fails if the page
 * scrolls sideways, and also if any visible element pokes out past the edge of
 * the viewport, which a clipping container would otherwise hide. Content inside
 * an element that scrolls sideways on purpose (overflow-x auto or scroll) is
 * allowed to be wider.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;

    const scrollsSideways = (element: Element): boolean => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (node !== document.documentElement && (overflowX === "auto" || overflowX === "scroll")) {
          return true;
        }
      }
      return false;
    };

    const describe = (element: Element): string => {
      const className = element.getAttribute("class") ?? "";
      return `<${element.tagName.toLowerCase()} class="${className.slice(0, 80)}">`;
    };

    const spilling: string[] = [];
    for (const element of document.body.querySelectorAll("*")) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (getComputedStyle(element).visibility === "hidden") continue;
      const outside = box.right > viewportWidth + 1 || box.left < -1;
      if (outside && !scrollsSideways(element)) {
        spilling.push(describe(element));
      }
    }

    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth,
      spilling: spilling.slice(0, 5),
    };
  });

  expect(report.documentWidth, "the page must not scroll sideways").toBeLessThanOrEqual(
    report.viewportWidth,
  );
  expect(report.spilling, "no element may extend past the viewport edge").toEqual([]);
}
