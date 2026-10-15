import {
  SIGN_IN_GRAPHICS,
  signInBackgroundSvg,
  signInFaviconSvg,
  signInGraphicSvg,
  signInLogoSvg,
  type ColourMode,
} from "../src/components/brand/sign-in-brand.ts";

/** Where Cognito's branding files live, in the infrastructure that deploys them. */
export const SIGN_IN_BRAND_DIRECTORY = new URL("../../../infra/src/managed-login/assets/", import.meta.url);

const MODES: readonly ColourMode[] = ["LIGHT", "DARK"];

/** Every branding file, by file name, as the generator draws it today. */
export function signInBrandFiles(): Record<string, string> {
  const files: Record<string, string> = { "favicon.svg": signInFaviconSvg() };
  for (const mode of MODES) {
    const suffix = mode.toLowerCase();
    files[`logo-${suffix}.svg`] = signInLogoSvg(mode);
    files[`page-background-${suffix}.svg`] = signInBackgroundSvg(mode);
    for (const graphic of SIGN_IN_GRAPHICS) {
      files[`${graphic.toLowerCase().replace("_", "-")}-graphic-${suffix}.svg`] = signInGraphicSvg(graphic, mode);
    }
  }
  return files;
}
