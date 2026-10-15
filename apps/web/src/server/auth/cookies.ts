import type { TokenSet } from "@kin/auth";

/**
 * The cookies that carry a session. httpOnly, so page scripts never see a
 * token. __Host- binds them to this exact origin over https. The refresh
 * token and the sign-in secrets travel only to /auth, where they are used.
 */
export const COOKIES = {
  access: "__Host-kin-access",
  id: "__Host-kin-id",
  refresh: "__Secure-kin-refresh",
  signIn: "__Secure-kin-sign-in",
} as const;

const AUTH_PATH = "/auth";
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

const base = { httpOnly: true, secure: true, sameSite: "lax" } as const;

export type CookieToSet = { name: string; value: string; options: CookieOptions };

/** The cookies a fresh token set leaves behind. A refresh without a new refresh token keeps the old one. */
export function sessionCookies(tokens: TokenSet): CookieToSet[] {
  const session = { ...base, path: "/", maxAge: tokens.expiresIn };
  const cookies: CookieToSet[] = [
    { name: COOKIES.access, value: tokens.accessToken, options: session },
    { name: COOKIES.id, value: tokens.idToken, options: session },
  ];
  if (tokens.refreshToken) {
    cookies.push({ name: COOKIES.refresh, value: tokens.refreshToken, options: { ...base, path: AUTH_PATH, maxAge: REFRESH_SECONDS } });
  }
  return cookies;
}

/** Every session cookie, set to expire now. */
export function clearedSessionCookies(): CookieToSet[] {
  return [
    { name: COOKIES.access, value: "", options: { ...base, path: "/", maxAge: 0 } },
    { name: COOKIES.id, value: "", options: { ...base, path: "/", maxAge: 0 } },
    { name: COOKIES.refresh, value: "", options: { ...base, path: AUTH_PATH, maxAge: 0 } },
  ];
}

export function signInCookie(value: string): CookieToSet {
  return { name: COOKIES.signIn, value, options: { ...base, path: AUTH_PATH, maxAge: SIGN_IN_SECONDS } };
}

export function clearedSignInCookie(): CookieToSet {
  return { name: COOKIES.signIn, value: "", options: { ...base, path: AUTH_PATH, maxAge: 0 } };
}
