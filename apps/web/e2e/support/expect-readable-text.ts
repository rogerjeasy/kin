import { expect, type Page } from "@playwright/test";

/**
 * The shared check that text can be read against what is behind it (WCAG 2.2
 * AA: 4.5 to 1, or 3 to 1 for large text). It composes each text element's
 * colour over the translucent backgrounds above it and measures the ratio.
 * Text over an image or gradient is skipped, and so is disabled text, which
 * the standard exempts.
 */
export async function expectReadableText(page: Page): Promise<void> {
  const weak = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return ["no canvas"];

    type Rgba = [number, number, number, number];
    const parse = (css: string): Rgba => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "#000";
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: Rgba, below: Rgba): Rgba => {
      const alpha = top[3] + below[3] * (1 - top[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      const mix = (i: 0 | 1 | 2) => (top[i] * top[3] + below[i] * below[3] * (1 - top[3])) / alpha;
      return [mix(0), mix(1), mix(2), alpha];
    };
    const luminance = ([r, g, b]: Rgba): number => {
      const channel = (value: number) => {
        const s = value / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };

    const failures: string[] = [];
    for (const element of document.body.querySelectorAll("*")) {
      const hasText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
      if (!hasText) continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || element.closest("[disabled], [aria-disabled='true'], script, style, noscript") !== null) continue;

      const chain: Element[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) chain.push(node);
      if (chain.some((node) => getComputedStyle(node).backgroundImage !== "none")) continue;
      const opacity = chain.reduce((total, node) => total * Number(getComputedStyle(node).opacity), 1);

      // Composite from the page outwards: the outermost background first.
      let background: Rgba = [255, 255, 255, 1];
      for (const node of chain.toReversed()) background = over(parse(getComputedStyle(node).backgroundColor), background);
      const [r, g, b, a] = parse(style.color);
      const foreground = over([r, g, b, a * opacity], background);
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      const ratio = (light + 0.05) / (dark + 0.05);
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const needed = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (ratio < needed) {
        failures.push(`${ratio.toFixed(2)}:1 (needs ${needed}) <${element.tagName.toLowerCase()} class="${(element.getAttribute("class") ?? "").slice(0, 70)}"> "${(element.textContent ?? "").trim().slice(0, 40)}"`);
      }
    }
    return failures.slice(0, 8);
  });
  expect(weak, "text must have enough contrast against its background").toEqual([]);
}
