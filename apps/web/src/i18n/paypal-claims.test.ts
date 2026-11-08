import { WEBHOOK_EVENT_TYPES } from "@kin/paypal";
import { describe, expect, it } from "vitest";

import { PAYOUT_RECORD } from "../content/example-family";
import { getDictionary } from "./dictionary";
import { locales } from "./locales";

// The denials the site once made, in each language. Kin's sandbox build lands
// every top-up in its own PayPal account (docs/architecture.md decision 70),
// so none of these may come back.
const OLD_CUSTODY_DENIALS = [
  "It does not hold funds",
  "Kin never holds the money",
  "never holds the money itself",
  "Il ne détient pas de fonds",
  "Kin ne détient jamais l’argent",
  "Kin verwahrt kein Geld",
  "Kin verwahrt das Geld nie",
  "No custodia fondos",
  "Kin nunca tiene el dinero en su poder",
  "Non detiene fondi",
  "Kin non detiene mai il denaro",
  "وهو لا يحتفظ بالأموال",
  "ولا يحتفظ Kin بالمال أبدًا",
  "הוא אינו מחזיק כספים",
  "Kin אף פעם לא מחזיק בכסף",
];

describe.each(locales)("the %s site copy and PayPal", (locale) => {
  it("does not say Kin never holds the money", async () => {
    const text = JSON.stringify(await getDictionary(locale));
    for (const denial of OLD_CUSTODY_DENIALS) expect(text).not.toContain(denial);
  });

  it("does not claim the stand-in seller, shipment tracking or disputes as live PayPal features", async () => {
    const { rows } = (await getDictionary(locale)).howItWorks.paypal;
    // Rows 5 to 7 are the purchase, delivery and dispute rows: each says what it is in this build.
    for (const row of rows.slice(5, 8)) expect(row.capability.includes("(")).toBe(true);
  });
});

describe("the PayPal record the public pages show", () => {
  it("is something Kin reads back, not a webhook event it never subscribed to", () => {
    expect(PAYOUT_RECORD).not.toMatch(/^PAYMENT\./);
    expect(WEBHOOK_EVENT_TYPES.some((type) => PAYOUT_RECORD.includes(type))).toBe(false);
    expect(PAYOUT_RECORD).toContain("SUCCESS");
  });
});
