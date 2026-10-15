import { readFileSync } from "node:fs";

import type * as cognito from "aws-cdk-lib/aws-cognito";

/**
 * How Cognito's managed sign-in and sign-up pages look: Kin's paper and navy,
 * its knot logo and its share colours. Cognito keeps its own default for
 * anything not set here. The SVG files are drawn by the web app's brand
 * module and exported with `pnpm --filter @kin/web run brand:export`.
 */

type Shade = string;

/** Cognito writes colours as RRGGBBAA. Every colour here is opaque. */
function opaque(rgb: Shade): string {
  return `${rgb}ff`;
}

/** The web app's design tokens, light and dark (apps/web/src/app/globals.css). */
const LIGHT = {
  paper: "faf7f2",
  card: "ffffff",
  ink: "1a1714",
  inkMuted: "5e564d",
  placeholder: "7a7166",
  navy: "1d2b4f",
  navyHover: "2a3c6a",
  navyActive: "141f3a",
  muted: "f3ede3",
  secondary: "efe8dc",
  border: "e4dcd0",
  input: "cfc5b5",
  highlight: "8a5a00",
  danger: "a3261e",
  dangerTint: "fbefed",
  positive: "1d6b3c",
  positiveTint: "eef6f0",
  warningTint: "fbf3e4",
} as const;

const DARK = {
  paper: "11131a",
  card: "1a1d27",
  ink: "f2eee7",
  inkMuted: "a9a69f",
  placeholder: "8f8c86",
  primary: "f2eee7",
  primaryHover: "e4ddd1",
  primaryActive: "d6cdbe",
  onPrimary: "11131a",
  secondary: "232735",
  border: "2b2f3c",
  input: "454b5e",
  highlight: "e9b872",
  danger: "f5a79e",
  dangerTint: "2a1513",
  positive: "86d3a0",
  positiveTint: "12231a",
  warningTint: "2a2112",
} as const;

const RADIUS = { form: 20, control: 12, button: 24 } as const;

const components = {
  form: {
    borderRadius: RADIUS.form,
    backgroundImage: { enabled: false },
    logo: { enabled: true, location: "CENTER", position: "TOP", formInclusion: "IN" },
    lightMode: { backgroundColor: opaque(LIGHT.card), borderColor: opaque(LIGHT.border) },
    darkMode: { backgroundColor: opaque(DARK.card), borderColor: opaque(DARK.border) },
  },
  pageBackground: {
    image: { enabled: true },
    lightMode: { color: opaque(LIGHT.paper) },
    darkMode: { color: opaque(DARK.paper) },
  },
  pageText: {
    lightMode: {
      headingColor: opaque(LIGHT.ink),
      bodyColor: opaque(LIGHT.inkMuted),
      descriptionColor: opaque(LIGHT.inkMuted),
    },
    darkMode: {
      headingColor: opaque(DARK.ink),
      bodyColor: opaque(DARK.inkMuted),
      descriptionColor: opaque(DARK.inkMuted),
    },
  },
  primaryButton: {
    lightMode: {
      defaults: { backgroundColor: opaque(LIGHT.navy), textColor: opaque(LIGHT.paper) },
      hover: { backgroundColor: opaque(LIGHT.navyHover), textColor: opaque(LIGHT.paper) },
      active: { backgroundColor: opaque(LIGHT.navyActive), textColor: opaque(LIGHT.paper) },
      disabled: { backgroundColor: opaque(LIGHT.secondary), borderColor: opaque(LIGHT.secondary) },
    },
    darkMode: {
      defaults: { backgroundColor: opaque(DARK.primary), textColor: opaque(DARK.onPrimary) },
      hover: { backgroundColor: opaque(DARK.primaryHover), textColor: opaque(DARK.onPrimary) },
      active: { backgroundColor: opaque(DARK.primaryActive), textColor: opaque(DARK.onPrimary) },
      disabled: { backgroundColor: opaque(DARK.secondary), borderColor: opaque(DARK.secondary) },
    },
  },
  secondaryButton: {
    lightMode: {
      defaults: { backgroundColor: opaque(LIGHT.card), borderColor: opaque(LIGHT.navy), textColor: opaque(LIGHT.navy) },
      hover: { backgroundColor: opaque(LIGHT.muted), borderColor: opaque(LIGHT.navy), textColor: opaque(LIGHT.navy) },
      active: { backgroundColor: opaque(LIGHT.secondary), borderColor: opaque(LIGHT.navyActive), textColor: opaque(LIGHT.navyActive) },
    },
    darkMode: {
      defaults: { backgroundColor: opaque(DARK.card), borderColor: opaque(DARK.ink), textColor: opaque(DARK.ink) },
      hover: { backgroundColor: opaque(DARK.secondary), borderColor: opaque(DARK.ink), textColor: opaque(DARK.ink) },
      active: { backgroundColor: opaque(DARK.border), borderColor: opaque(DARK.ink), textColor: opaque(DARK.ink) },
    },
  },
  alert: {
    borderRadius: RADIUS.control,
    lightMode: { error: { backgroundColor: opaque(LIGHT.dangerTint), borderColor: opaque(LIGHT.danger) } },
    darkMode: { error: { backgroundColor: opaque(DARK.dangerTint), borderColor: opaque(DARK.danger) } },
  },
  favicon: { enabledTypes: ["SVG"] },
};

const componentClasses = {
  buttons: { borderRadius: RADIUS.button },
  input: {
    borderRadius: RADIUS.control,
    lightMode: {
      defaults: { backgroundColor: opaque(LIGHT.card), borderColor: opaque(LIGHT.input) },
      placeholderColor: opaque(LIGHT.placeholder),
    },
    darkMode: {
      defaults: { backgroundColor: opaque(DARK.paper), borderColor: opaque(DARK.input) },
      placeholderColor: opaque(DARK.placeholder),
    },
  },
  inputLabel: {
    lightMode: { textColor: opaque(LIGHT.ink) },
    darkMode: { textColor: opaque(DARK.ink) },
  },
  inputDescription: {
    lightMode: { textColor: opaque(LIGHT.inkMuted) },
    darkMode: { textColor: opaque(DARK.inkMuted) },
  },
  dropDown: {
    borderRadius: RADIUS.control,
    lightMode: {
      defaults: { itemBackgroundColor: opaque(LIGHT.card) },
      hover: {
        itemBackgroundColor: opaque(LIGHT.muted),
        itemBorderColor: opaque(LIGHT.input),
        itemTextColor: opaque(LIGHT.ink),
      },
      match: { itemBackgroundColor: opaque(LIGHT.secondary), itemTextColor: opaque(LIGHT.navy) },
    },
    darkMode: {
      defaults: { itemBackgroundColor: opaque(DARK.card) },
      hover: {
        itemBackgroundColor: opaque(DARK.secondary),
        itemBorderColor: opaque(DARK.input),
        itemTextColor: opaque(DARK.ink),
      },
      match: { itemBackgroundColor: opaque(DARK.secondary), itemTextColor: opaque(DARK.highlight) },
    },
  },
  optionControls: {
    lightMode: {
      defaults: { backgroundColor: opaque(LIGHT.card), borderColor: opaque(LIGHT.input) },
      selected: { backgroundColor: opaque(LIGHT.navy), foregroundColor: opaque(LIGHT.paper) },
    },
    darkMode: {
      defaults: { backgroundColor: opaque(DARK.paper), borderColor: opaque(DARK.input) },
      selected: { backgroundColor: opaque(DARK.highlight), foregroundColor: opaque(DARK.onPrimary) },
    },
  },
  statusIndicator: {
    lightMode: {
      success: {
        backgroundColor: opaque(LIGHT.positiveTint),
        borderColor: opaque(LIGHT.positive),
        indicatorColor: opaque(LIGHT.positive),
      },
      warning: {
        backgroundColor: opaque(LIGHT.warningTint),
        borderColor: opaque(LIGHT.highlight),
        indicatorColor: opaque(LIGHT.highlight),
      },
      error: {
        backgroundColor: opaque(LIGHT.dangerTint),
        borderColor: opaque(LIGHT.danger),
        indicatorColor: opaque(LIGHT.danger),
      },
      pending: { indicatorColor: opaque(LIGHT.inkMuted) },
    },
    darkMode: {
      success: {
        backgroundColor: opaque(DARK.positiveTint),
        borderColor: opaque(DARK.positive),
        indicatorColor: opaque(DARK.positive),
      },
      warning: {
        backgroundColor: opaque(DARK.warningTint),
        borderColor: opaque(DARK.highlight),
        indicatorColor: opaque(DARK.highlight),
      },
      error: {
        backgroundColor: opaque(DARK.dangerTint),
        borderColor: opaque(DARK.danger),
        indicatorColor: opaque(DARK.danger),
      },
      pending: { indicatorColor: opaque(DARK.inkMuted) },
    },
  },
  divider: {
    lightMode: { borderColor: opaque(LIGHT.border) },
    darkMode: { borderColor: opaque(DARK.border) },
  },
  focusState: {
    lightMode: { borderColor: opaque(LIGHT.navy) },
    darkMode: { borderColor: opaque(DARK.highlight) },
  },
  link: {
    lightMode: { defaults: { textColor: opaque(LIGHT.navy) }, hover: { textColor: opaque(LIGHT.highlight) } },
    darkMode: { defaults: { textColor: opaque(DARK.highlight) }, hover: { textColor: opaque(DARK.ink) } },
  },
};

const categories = {
  // DYNAMIC follows the person's light or dark preference, as the app does.
  global: {
    colorSchemeMode: "DYNAMIC",
    spacingDensity: "REGULAR",
    pageHeader: { enabled: false },
    pageFooter: { enabled: false },
  },
  form: {
    displayGraphics: true,
    instructions: { enabled: false },
    sessionTimerDisplay: "NONE",
    location: { horizontal: "CENTER", vertical: "CENTER" },
  },
};

/** The settings document of `CfnManagedLoginBranding`. */
export const MANAGED_LOGIN_SETTINGS = { components, componentClasses, categories } as const;

const ASSET_DIRECTORY = new URL("./assets/", import.meta.url);

/** Which exported file Cognito shows in each place, by colour mode. */
const ASSET_FILES = [
  ["FORM_LOGO", "logo"],
  ["PAGE_BACKGROUND", "page-background"],
  ["EMAIL_GRAPHIC", "email-graphic"],
  ["PASSWORD_GRAPHIC", "password-graphic"],
  ["SMS_GRAPHIC", "sms-graphic"],
  ["AUTH_APP_GRAPHIC", "auth-app-graphic"],
  ["PASSKEY_GRAPHIC", "passkey-graphic"],
] as const;

const COLOUR_MODES = ["LIGHT", "DARK"] as const;

function svgAsset(category: string, colorMode: string, fileName: string): cognito.CfnManagedLoginBranding.AssetTypeProperty {
  return {
    category,
    colorMode,
    extension: "SVG",
    bytes: readFileSync(new URL(fileName, ASSET_DIRECTORY)).toString("base64"),
  };
}

/** Every image of the sign-in pages, read from the exported files. */
export function managedLoginAssets(): cognito.CfnManagedLoginBranding.AssetTypeProperty[] {
  return [
    ...COLOUR_MODES.flatMap((mode) =>
      ASSET_FILES.map(([category, base]) => svgAsset(category, mode, `${base}-${mode.toLowerCase()}.svg`)),
    ),
    // The favicon has no dark variant: the knot sits on its own navy tile.
    ...COLOUR_MODES.map((mode) => svgAsset("FAVICON_SVG", mode, "favicon.svg")),
  ];
}
