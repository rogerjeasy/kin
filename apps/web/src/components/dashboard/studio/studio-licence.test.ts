import { describe, expect, it } from "vitest";

import { studioLicence, type LicenceDetails } from "./studio-licence";

const missing: LicenceDetails = { missing: true, valid: false };
const good: LicenceDetails = { valid: true, expired: false };
const refused: LicenceDetails = { valid: false };

describe("the studio's licence decision", () => {
  it("runs AG Studio unlicensed, with its watermark, when no key was built in", () => {
    expect(studioLicence(missing, missing)).toEqual({ kind: "unlicensed", ai: true });
  });

  it("runs AG Studio with its agents for a key that covers AI", () => {
    expect(studioLicence(good, good)).toEqual({ kind: "licensed", ai: true });
  });

  it("runs AG Studio without its agents for a key that covers only the studio", () => {
    expect(studioLicence(refused, good)).toEqual({ kind: "licensed", ai: false });
  });

  it("falls back to Kin's summary once a trial key has expired", () => {
    const lapsedTrial: LicenceDetails = { valid: true, trialExpired: true };
    expect(studioLicence(lapsedTrial, lapsedTrial)).toEqual({ kind: "lapsed" });
  });

  it("falls back to Kin's summary for a key this version is not entitled to", () => {
    const tooOld: LicenceDetails = { valid: true, expired: true };
    expect(studioLicence(tooOld, tooOld)).toEqual({ kind: "lapsed" });
  });

  it("falls back to Kin's summary for a key AG Studio refuses", () => {
    expect(studioLicence(refused, refused)).toEqual({ kind: "lapsed" });
  });
});
