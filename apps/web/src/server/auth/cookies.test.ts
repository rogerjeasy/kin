import { describe, expect, it } from "vitest";

import { COOKIES, clearedSessionCookies, sessionCookies, signInCookie } from "./cookies";
import { decodeFlow, encodeFlow } from "./sign-in-flow";

const tokens = { accessToken: "a", idToken: "i", refreshToken: "r", expiresIn: 3600 };

describe("the session cookies", () => {
  it("are httpOnly, secure and same-site, and live as long as the tokens", () => {
    for (const cookie of sessionCookies(tokens)) {
      expect(cookie.options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
    }
    expect(sessionCookies(tokens).find((cookie) => cookie.name === COOKIES.access)?.options).toMatchObject({ path: "/", maxAge: 3600 });
  });

  it("are all bound to this exact origin, so no other subdomain can plant one", () => {
    for (const name of Object.values(COOKIES)) {
      expect(name.startsWith("__Host-")).toBe(true);
    }
    for (const cookie of [...sessionCookies(tokens), signInCookie("x")]) {
      expect(cookie.options.path).toBe("/");
    }
  });

  it("keep the refresh token in hand when a refresh returns none", () => {
    expect(sessionCookies({ ...tokens, refreshToken: null }).map((cookie) => cookie.name)).toEqual([COOKIES.access, COOKIES.id]);
  });

  it("all expire at once when cleared", () => {
    expect(clearedSessionCookies().map((cookie) => [cookie.name, cookie.options.maxAge])).toEqual([
      [COOKIES.access, 0],
      [COOKIES.id, 0],
      [COOKIES.refresh, 0],
    ]);
  });
});

describe("one sign-in's secrets", () => {
  const flow = { verifier: "v", state: "s", nonce: "n", next: "/dashboard" };

  it("last ten minutes, out of reach of page scripts", () => {
    expect(signInCookie(encodeFlow(flow)).options).toMatchObject({ path: "/", maxAge: 600, httpOnly: true, secure: true });
  });

  it("come back exactly as they left", () => {
    expect(decodeFlow(encodeFlow(flow))).toEqual(flow);
  });

  it.each(["https://evil.example/", "//evil.example/dashboard", "/pricing"])(
    "never send the browser to %s, even from a planted cookie",
    (next) => {
      expect(decodeFlow(encodeFlow({ ...flow, next }))?.next).toBe("/dashboard");
    },
  );

  it.each([undefined, "", "not-base64-json", Buffer.from(JSON.stringify({ ...flow, state: "" })).toString("base64url"), Buffer.from("[]").toString("base64url")])(
    "are refused when tampered with or missing (%s)",
    (raw) => {
      expect(decodeFlow(raw)).toBeNull();
    },
  );
});
