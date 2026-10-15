import type { Session } from "@kin/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { sessionVerifier } from "./config";
import { COOKIES } from "./cookies";

/**
 * The signed-in person, verified from their tokens, or `null`. Cached for the
 * length of one request, so a page and its layout verify once between them.
 */
export const currentSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  const accessToken = jar.get(COOKIES.access)?.value;
  const idToken = jar.get(COOKIES.id)?.value;
  if (!accessToken || !idToken) return null;
  return sessionVerifier().verify({ accessToken, idToken });
});

/**
 * The session a circle screen needs before it reads anything. Without one,
 * the browser goes to renew it, and from there to sign in. Every page and
 * layout under /dashboard calls this: the proxy's check alone is not enough.
 */
export async function requireSession(path: string): Promise<Session> {
  const session = await currentSession();
  if (!session) {
    redirect(`/auth/refresh?${new URLSearchParams({ next: path }).toString()}`);
  }
  return session;
}
