import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A value that travels through the caller's phone company and comes back,
 * made tamper-proof: base64url(JSON) + "." + base64url(HMAC-SHA256). Whoever
 * holds the token can read it and cannot change it.
 */
const mac = (body: string, key: string): Buffer => createHmac("sha256", key).update(body, "utf8").digest();

export function sealToken(payload: unknown, key: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${mac(body, key).toString("base64url")}`;
}

/** The payload of a token this key sealed, as untrusted JSON for the caller to parse; `null` for anything else. */
export function openToken(token: string, key: string): unknown {
  const [body, tag, extra] = token.split(".");
  if (body === undefined || tag === undefined || extra !== undefined) return null;
  const given = Buffer.from(tag, "base64url");
  const expected = mac(body, key);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown;
  } catch {
    return null;
  }
}
