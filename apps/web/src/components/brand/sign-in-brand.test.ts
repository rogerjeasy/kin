import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SIGN_IN_BRAND_DIRECTORY, signInBrandFiles } from "../../../scripts/sign-in-brand-files.ts";
import { SIGN_IN_GRAPHICS, signInBackgroundSvg, signInGraphicSvg, signInLogoSvg } from "./sign-in-brand.ts";

describe("the branding of Cognito's sign-in pages", () => {
  it.each(Object.entries(signInBrandFiles()))("%s in the infrastructure is what the generator draws (run brand:export)", (name, svg) => {
    expect(readFileSync(new URL(name, SIGN_IN_BRAND_DIRECTORY), "utf8")).toBe(`${svg}\n`);
  });

  it("uses only what Cognito lets an SVG contain: no scripts, links or foreign objects", () => {
    for (const svg of Object.values(signInBrandFiles())) {
      expect(svg).not.toMatch(/<script|<foreignObject|xlink:href|href="http|on[a-z]+=/i);
    }
  });

  it("stops every animation for someone who asked for less motion", () => {
    for (const svg of [signInLogoSvg("LIGHT"), signInBackgroundSvg("DARK")]) {
      expect(svg).toContain("@media (prefers-reduced-motion: reduce){*{animation:none!important}}");
    }
  });

  it("draws the logo and the graphics in each colour mode's own ink", () => {
    expect(signInLogoSvg("LIGHT")).toContain('stroke="#1d2b4f"');
    expect(signInLogoSvg("DARK")).toContain('stroke="#f2eee7"');
    for (const graphic of SIGN_IN_GRAPHICS) {
      expect(signInGraphicSvg(graphic, "DARK")).toContain('fill="#232735"');
    }
  });

  it("keeps each file small, since every one travels inside the deployment template", () => {
    for (const svg of Object.values(signInBrandFiles())) {
      expect(svg.length).toBeLessThan(8_000);
    }
  });
});
