import { describe, expect, it } from "vitest";

import { AGENCY_SIGNATURE_WINDOW_SECONDS, agencySecret, hashAgencySecret, isAgencyKeyId, newAgencyKeyId, signAgencyRequest, verifyAgencySignature } from "./agency-signature.ts";

const SIGNING_KEY = "a server signing key of at least thirty-two characters";
const NOW = new Date("2026-11-09T12:00:00Z");
const seconds = NOW.getTime() / 1000;
const body = JSON.stringify({ externalId: "visit-1", caregiver: "Amara" });

describe("an agency's signed request", () => {
  const keyId = newAgencyKeyId();
  const secret = agencySecret(SIGNING_KEY, keyId);

  it("derives each key's secret from the server's key, so nothing secret is stored", () => {
    expect(isAgencyKeyId(keyId)).toBe(true);
    expect(secret).toMatch(/^kin_ags_[A-Za-z0-9_-]{43}$/u);
    expect(agencySecret(SIGNING_KEY, keyId)).toBe(secret);
    expect(agencySecret(SIGNING_KEY, newAgencyKeyId())).not.toBe(secret);
    expect(agencySecret("another server key, also thirty-two characters long", keyId)).not.toBe(secret);
    expect(hashAgencySecret(secret)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("is accepted with the right secret, body and time", () => {
    expect(verifyAgencySignature({ secret, header: signAgencyRequest(secret, seconds, body), rawBody: body, now: NOW })).toEqual({ ok: true, timestampSeconds: seconds });
  });

  it("is refused when a byte of the body changes, or another key signed it", () => {
    const header = signAgencyRequest(secret, seconds, body);
    expect(verifyAgencySignature({ secret, header, rawBody: `${body} `, now: NOW })).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyAgencySignature({ secret: agencySecret(SIGNING_KEY, newAgencyKeyId()), header, rawBody: body, now: NOW })).toEqual({ ok: false, reason: "mismatch" });
  });

  it("is refused outside the time window, so a captured request cannot be replayed later", () => {
    const old = seconds - AGENCY_SIGNATURE_WINDOW_SECONDS - 1;
    expect(verifyAgencySignature({ secret, header: signAgencyRequest(secret, old, body), rawBody: body, now: NOW })).toEqual({ ok: false, reason: "stale" });
    const ahead = seconds + AGENCY_SIGNATURE_WINDOW_SECONDS + 1;
    expect(verifyAgencySignature({ secret, header: signAgencyRequest(secret, ahead, body), rawBody: body, now: NOW })).toEqual({ ok: false, reason: "stale" });
    const edge = seconds - AGENCY_SIGNATURE_WINDOW_SECONDS;
    expect(verifyAgencySignature({ secret, header: signAgencyRequest(secret, edge, body), rawBody: body, now: NOW }).ok).toBe(true);
  });

  it("is refused when the header is missing or not Kin's shape", () => {
    for (const header of [null, "", "v1=abc", `t=${seconds}`, `t=${seconds},v1=${"0".repeat(63)}`, `t=x,v1=${"0".repeat(64)}`, `t=${seconds},v1=${"A".repeat(64)}`]) {
      expect(verifyAgencySignature({ secret, header, rawBody: body, now: NOW })).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("knows a key ID by its shape", () => {
    for (const value of [null, "", "agk_short", `ags_${"a".repeat(22)}`, `agk_${"a".repeat(22)}!`]) expect(isAgencyKeyId(value)).toBe(false);
  });
});
