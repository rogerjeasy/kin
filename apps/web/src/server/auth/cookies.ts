import type { TokenSet } from "@kin/auth";

/**
 * The cookies that carry a session. httpOnly, so page scripts never see a
 * token. Every one is __Host-: bound to this exact origin over https, with no
 * Domain, so a neighbouring subdomain cannot plant one. A planted sign-in or
 * refresh cookie could otherwise sign someone into an attacker's account.
 * __Host- requires the path /, so these cookies cannot be scoped to /auth.
 */
export const COOKIES = {
  access: "__Host-kin-access",
  id: "__Host-kin-id",
  refresh: "__Host-kin-refresh",
  signIn: "__Host-kin-sign-in",
  /** An authenticator enrolment in progress, sealed by the server (enrolment-seal.ts). */
  enrolment: "__Host-kin-enrolment",
} as const;

const REFRESH_SECONDS = 7 * 24 * 60 * 60;
/** A sign-in that takes longer than this starts again. */
const SIGN_IN_SECONDS = 10 * 60;

type CookieOptions = {
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

const base = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;

export type CookieToSet = { name: string; value: string; options: CookieOptions };

/** The cookies a fresh token set leaves behind. A refresh without a new refresh token keeps the old one. */
export function sessionCookies(tokens: TokenSet): CookieToSet[] {
  const session = { ...base, maxAge: tokens.expiresIn };
  const cookies: CookieToSet[] = [
    { name: COOKIES.access, value: tokens.accessToken, options: session },
    { name: COOKIES.id, value: tokens.idToken, options: session },
  ];
  if (tokens.refreshToken) {
    cookies.push({ name: COOKIES.refresh, value: tokens.refreshToken, options: { ...base, maxAge: REFRESH_SECONDS } });
  }
  return cookies;
}

/** Every session cookie, set to expire now. */
export function clearedSessionCookies(): CookieToSet[] {
  return [
    { name: COOKIES.access, value: "", options: { ...base, maxAge: 0 } },
    { name: COOKIES.id, value: "", options: { ...base, maxAge: 0 } },
    { name: COOKIES.refresh, value: "", options: { ...base, maxAge: 0 } },
  ];
}

export function signInCookie(value: string): CookieToSet {
  return { name: COOKIES.signIn, value, options: { ...base, maxAge: SIGN_IN_SECONDS } };
}

/**
 * Lax like the session's: the browser arrives from the provider's page, and a
 * strict cookie would be held back on that first screen. Only Kin's own
 * pages can use it: the route that confirms checks the origin.
 */
export function enrolmentCookie(value: string, maxAge: number): CookieToSet {
  return { name: COOKIES.enrolment, value, options: { ...base, maxAge } };
}

export function clearedEnrolmentCookie(): CookieToSet {
  return { name: COOKIES.enrolment, value: "", options: { ...base, maxAge: 0 } };
}

export function clearedSignInCookie(): CookieToSet {
  return { name: COOKIES.signIn, value: "", options: { ...base, maxAge: 0 } };
}
