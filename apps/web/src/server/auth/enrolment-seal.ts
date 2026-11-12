import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * What an authenticator enrolment keeps while the person scans the code: the
 * access token of their fresh sign-in (the only token that may set up the
 * app), its refresh token so it can be revoked at the end, and the secret.
 */
export type Enrolment = {
  readonly userId: string;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly secret: string;
  /** When the fresh sign-in came back, in milliseconds. */
  readonly startedAt: number;
};

/** Ten minutes to scan a code and type one back; then the person starts again. */
export const ENROLMENT_SECONDS = 600;

const VERSION = "v1";
const AAD = Buffer.from("kin authenticator enrolment v1");
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Seals an enrolment with AES-256-GCM under a key only the server holds. The
 * browser carries the sealed bytes in an httpOnly cookie and can neither read
 * the token inside nor change a byte of it.
 */
export function sealEnrolment(key: Buffer, enrolment: Enrolment): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(JSON.stringify(enrolment), "utf8"), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

/** The enrolment, or `null` when the cookie is missing, forged, for another key or past its ten minutes. */
export function openEnrolment(key: Buffer, raw: string | undefined, now: Date): Enrolment | null {
  if (!raw?.startsWith(`${VERSION}.`)) return null;
  const bytes = Buffer.from(raw.slice(VERSION.length + 1), "base64url");
  if (bytes.length <= IV_BYTES + TAG_BYTES) return null;
  let value: Record<string, unknown>;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, IV_BYTES));
    decipher.setAAD(AAD);
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const { userId, accessToken, refreshToken, secret, startedAt } = value;
  if (typeof userId !== "string" || typeof accessToken !== "string" || typeof secret !== "string" || typeof startedAt !== "number") return null;
  if (refreshToken !== null && typeof refreshToken !== "string") return null;
  const age = now.getTime() - startedAt;
  if (age < 0 || age > ENROLMENT_SECONDS * 1000) return null;
  return { userId, accessToken, refreshToken, secret, startedAt };
}
