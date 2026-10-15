import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MANAGED_LOGIN_SETTINGS, managedLoginAssets } from "./branding.ts";

const assets = managedLoginAssets();

/** Every string in the settings whose key names a colour. */
function colours(value: unknown, key = ""): string[] {
  if (typeof value === "string") return /color$/i.test(key) ? [value] : [];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([childKey, child]) => colours(child, childKey));
}

describe("the managed login branding", () => {
  it("writes every colour as Cognito's eight-digit RRGGBBAA hex", () => {
    const all = colours(MANAGED_LOGIN_SETTINGS);
    expect(all.length).toBeGreaterThan(50);
    for (const colour of all) expect(colour).toMatch(/^[0-9a-f]{8}$/);
  });

  it("follows the person's light or dark preference", () => {
    expect(MANAGED_LOGIN_SETTINGS.categories.global.colorSchemeMode).toBe("DYNAMIC");
  });

  it("puts Kin's logo in the form", () => {
    expect(MANAGED_LOGIN_SETTINGS.components.form.logo.enabled).toBe(true);
  });

  it("gives each image both a light and a dark version", () => {
    const byCategory = new Map<string, string[]>();
    for (const asset of assets) {
      byCategory.set(asset.category, [...(byCategory.get(asset.category) ?? []), asset.colorMode]);
    }
    expect([...byCategory.keys()].sort()).toEqual([
      "AUTH_APP_GRAPHIC",
      "EMAIL_GRAPHIC",
      "FAVICON_SVG",
      "FORM_LOGO",
      "PAGE_BACKGROUND",
      "PASSKEY_GRAPHIC",
      "PASSWORD_GRAPHIC",
      "SMS_GRAPHIC",
    ]);
    for (const modes of byCategory.values()) expect(modes.sort()).toEqual(["DARK", "LIGHT"]);
  });

  it("uploads the exported SVG files unchanged", () => {
    const directory = new URL("./assets/", import.meta.url);
    const committed = new Set(readdirSync(directory).map((name) => readFileSync(new URL(name, directory), "utf8")));
    for (const asset of assets) {
      expect(asset.extension).toBe("SVG");
      expect(committed.has(Buffer.from(asset.bytes ?? "", "base64").toString("utf8"))).toBe(true);
    }
  });

  it("uses every exported file", () => {
    const directory = new URL("./assets/", import.meta.url);
    const used = new Set(assets.map((asset) => asset.bytes));
    for (const name of readdirSync(directory)) {
      expect(used.has(readFileSync(new URL(name, directory)).toString("base64")), name).toBe(true);
    }
  });
});
