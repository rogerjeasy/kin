import { DEMO_SESSION_DAYS } from "@kin/auth";

/**
 * The cookie that carries a demo visitor's session. httpOnly and __Host-, like
 * the sign-in cookies (cookies.ts), so no page script reads it and no other
 * subdomain can plant one.
 */
export const DEMO_COOKIE = "__Host-kin-demo";

const base = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;

export function demoCookie(value: string) {
  return { name: DEMO_COOKIE, value, options: { ...base, maxAge: DEMO_SESSION_DAYS * 24 * 60 * 60 } };
}

export function clearedDemoCookie() {
  return { name: DEMO_COOKIE, value: "", options: { ...base, maxAge: 0 } };
}
