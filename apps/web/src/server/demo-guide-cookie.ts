import { DEMO_SESSION_DAYS } from "@kin/auth";
import { cookies } from "next/headers";

/**
 * Whether this visitor put the demo's five-step guide away. A preference, not
 * a secret: it only hides the guide, and the server reads it so the page never
 * flashes the guide before hiding it. Lasts as long as a demo session.
 */
export const DEMO_GUIDE_COOKIE = "__Host-kin-demo-guide";

const HIDDEN = "hidden";

export async function demoGuideHidden(): Promise<boolean> {
  return (await cookies()).get(DEMO_GUIDE_COOKIE)?.value === HIDDEN;
}

export async function rememberDemoGuide(hidden: boolean): Promise<void> {
  const options = { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: hidden ? DEMO_SESSION_DAYS * 24 * 60 * 60 : 0 } as const;
  (await cookies()).set(DEMO_GUIDE_COOKIE, hidden ? HIDDEN : "", options);
}
