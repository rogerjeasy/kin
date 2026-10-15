import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { issueDemoSession, readDemoSession } from "./demo-session.ts";

const key = "k".repeat(48);
const now = new Date("2026-10-15T12:00:00Z");
const later = new Date("2026-10-29T12:00:00Z");
const session = { visitorId: "demo:5f1b7c1e-2d1a-4a67-9c43-21a0a3b6f2d9", expiresAt: later };

describe("a demo visitor's session", () => {
  it("comes back exactly as it was issued", () => {
    expect(readDemoSession(key, issueDemoSession(key, session), now)).toEqual(session);
  });

  it("is refused once it has expired", () => {
    expect(readDemoSession(key, issueDemoSession(key, session), later)).toBeNull();
  });

  it("is refused when signed with another key", () => {
    expect(readDemoSession(key, issueDemoSession("x".repeat(48), session), now)).toBeNull();
  });

  it("is refused when its contents are changed, even to another visitor", () => {
    const token = issueDemoSession(key, session);
    const [, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, sub: "demo:someone-else", exp: later.getTime() })).toString("base64url");
    expect(readDemoSession(key, `${forged}.${signature}`, now)).toBeNull();
  });

  it("can never name a person who signed in, so it cannot open a real circle", () => {
    expect(() => issueDemoSession(key, { ...session, visitorId: "5f1b7c1e-2d1a-4a67-9c43-21a0a3b6f2d9" })).toThrow(/demo visitor/);
    const payload = Buffer.from(JSON.stringify({ v: 1, sub: "5f1b7c1e-person", exp: later.getTime() })).toString("base64url");
    // Even correctly signed, a token for a non-visitor ID is refused.
    const signature = createHmac("sha256", key).update(payload).digest("base64url");
    expect(readDemoSession(key, `${payload}.${signature}`, now)).toBeNull();
  });

  it.each([undefined, "", "abc", "a.b.c", "not-base64.sig"])("is refused when malformed (%s)", (token) => {
    expect(readDemoSession(key, token, now)).toBeNull();
  });

  it("needs a key long enough to resist guessing", () => {
    expect(() => readDemoSession("short", "x.y", now)).toThrow(/32/);
  });
});
