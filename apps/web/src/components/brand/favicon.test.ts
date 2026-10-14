import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { faviconSvg } from "./favicon";
import { KNOT_MARK, knot, strandPath } from "./knot-geometry";

const stylesheet = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

/** The light-theme value of a colour token, which is the first one in the stylesheet. */
function token(name: string): string {
  const value = new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`).exec(stylesheet)?.[1];
  if (!value) throw new Error(`globals.css does not define --${name}`);
  return value;
}

describe("faviconSvg", () => {
  const svg = faviconSvg();

  it("is a square SVG image", () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("draws the same knot as the logo", () => {
    const { strands, centre } = knot(KNOT_MARK);

    for (const strand of strands) {
      expect(svg).toContain(`d="${strandPath(strand)}"`);
    }
    expect(svg).toContain(`stroke-width="${KNOT_MARK.strokeWidth}"`);
    expect(svg).toContain(`cx="${centre.x}" cy="${centre.y}" r="${KNOT_MARK.centreRadius}"`);
  });

  it("takes its colours from the navy band, which looks the same in both themes", () => {
    expect(svg).toContain(`<rect width="64" height="64" rx="14" fill="${token("band")}"/>`);
    expect(svg).toContain(`stroke="${token("band-foreground")}"`);
    expect(svg).toContain(`fill="${token("band-highlight")}"`);
  });
});
