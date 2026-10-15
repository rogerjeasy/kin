import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The session of an anonymous visitor who pressed the Demo button. It names
 * only a demo visitor (an ID starting "demo:"), who can hold seats in demo
 * circles only, so it can never open a real family's circle. It is signed
 * with a key from Secrets Manager and kept in an httpOnly cookie.
 */
export type DemoSession = { readonly visitorId: string; readonly expiresAt: Date };

/** How long a visitor keeps their demo circle without pressing the button again. */
export const DEMO_SESSION_DAYS = 14;

const VERSION = 1;
const MIN_KEY_LENGTH = 32;
const PREFIX = "demo:";

function sign(key: string, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function assertKey(key: string): void {
  if (key.length < MIN_KEY_LENGTH) throw new Error(`A demo session key needs at least ${MIN_KEY_LENGTH} characters`);
}

/** The cookie value that carries a visitor's session. */
export function issueDemoSession(key: string, session: DemoSession): string {
  assertKey(key);
  if (!session.visitorId.startsWith(PREFIX)) throw new Error("A demo session can only name a demo visitor");
  const payload = Buffer.from(JSON.stringify({ v: VERSION, sub: session.visitorId, exp: session.expiresAt.getTime() })).toString("base64url");
  return `${payload}.${sign(key, payload)}`;
}

/** The session a cookie proves, or `null`: unsigned, forged, expired or malformed. */
export function readDemoSession(key: string, token: string | undefined, now: Date): DemoSession | null {
  assertKey(key);
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(key, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null) return null;
  const { v, sub, exp } = claims as Record<string, unknown>;
  if (v !== VERSION || typeof sub !== "string" || !sub.startsWith(PREFIX) || typeof exp !== "number") return null;
  if (exp <= now.getTime()) return null;
  return { visitorId: sub, expiresAt: new Date(exp) };
}
