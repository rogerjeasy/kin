import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * How a home-care agency's software proves a request to Kin's API is its own
 * (docs/architecture.md section 13.5). The organizer creates a key for the
 * circle; Kin shows its secret once. The agency signs each request with
 * HMAC-SHA256 over the timestamp and the raw body, Stripe-style:
 *
 *   Kin-Agency-Key: agk_…
 *   Kin-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *
 * The secret is not stored anywhere. It is derived from the server's signing
 * key and the key's public ID, so the database holds only the ID and the
 * secret's SHA-256: a copy of the table lets nobody sign. A request older or
 * newer than the window is refused, so a captured one cannot be replayed
 * later; inside the window the same body is idempotent by its external ID.
 */

/** How far a request's timestamp may be from Kin's clock. */
export const AGENCY_SIGNATURE_WINDOW_SECONDS = 300;

export const AGENCY_KEY_HEADER = "kin-agency-key";
export const AGENCY_SIGNATURE_HEADER = "kin-signature";

const KEY_ID_SHAPE = /^agk_[A-Za-z0-9_-]{22}$/u;
const SIGNATURE_SHAPE = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/u;

/** A new public key ID: 16 random bytes as base64url, behind a prefix. */
export const newAgencyKeyId = (): string => `agk_${randomBytes(16).toString("base64url")}`;

export const isAgencyKeyId = (value: string | null): value is string => value !== null && KEY_ID_SHAPE.test(value);

/** The key's secret, derived from the server's signing key and the key's ID. Shown once, never stored. */
export function agencySecret(signingKey: string, keyId: string): string {
  return `kin_ags_${createHmac("sha256", signingKey).update(`kin agency key v1:${keyId}`, "utf8").digest("base64url")}`;
}

/** The SHA-256 of a secret in lowercase hex, which is what the database keeps to recognise it. */
export const hashAgencySecret = (secret: string): string => createHash("sha256").update(secret, "utf8").digest("hex");

/** The signature an agency sends, for its own tests and the developer page's example. */
export function signAgencyRequest(secret: string, timestampSeconds: number, rawBody: string): string {
  const mac = createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`, "utf8").digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
}

export type AgencySignatureVerdict = { readonly ok: true; readonly timestampSeconds: number } | { readonly ok: false; readonly reason: "malformed" | "stale" | "mismatch" };

/**
 * Whether `header` signs exactly `rawBody` with `secret`, at a time within
 * the window around `now`. The comparison takes the same time whatever the
 * signature, so a wrong one teaches an attacker nothing.
 */
export function verifyAgencySignature(input: { readonly secret: string; readonly header: string | null; readonly rawBody: string; readonly now: Date }): AgencySignatureVerdict {
  const match = input.header === null ? null : SIGNATURE_SHAPE.exec(input.header.trim());
  const [, stamp, given] = match ?? [];
  if (stamp === undefined || given === undefined) return { ok: false, reason: "malformed" };
  const timestampSeconds = Number(stamp);
  if (Math.abs(input.now.getTime() / 1000 - timestampSeconds) > AGENCY_SIGNATURE_WINDOW_SECONDS) return { ok: false, reason: "stale" };
  const expected = createHmac("sha256", input.secret).update(`${timestampSeconds}.${input.rawBody}`, "utf8").digest();
  return timingSafeEqual(expected, Buffer.from(given, "hex")) ? { ok: true, timestampSeconds } : { ok: false, reason: "mismatch" };
}
