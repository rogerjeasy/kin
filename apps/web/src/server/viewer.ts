import { readDemoSession, type Session } from "@kin/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { currentSession } from "./auth/session";
import { DEMO_COOKIE } from "./auth/demo-cookie";
import { demoConfig } from "./demo-config";

/**
 * Who is looking at the circle's screens: an anonymous visitor in the demo,
 * or a person who signed in. A visitor sees only their demo circle, and a
 * person only their real ones, never the demo.
 */
export type Viewer =
  | { readonly kind: "visitor"; readonly userId: string }
  | { readonly kind: "person"; readonly userId: string; readonly session: Session };

/** The visitor whose demo cookie is valid, if the demo is on. */
export async function currentVisitor(): Promise<string | null> {
  const demo = demoConfig();
  if (!demo.enabled) return null;
  const jar = await cookies();
  return readDemoSession(demo.sessionKey, jar.get(DEMO_COOKIE)?.value, new Date())?.visitorId ?? null;
}

/**
 * Who the viewer is, given what the request carries. A person who signed in is
 * always themselves: their real circles, never the demo, even if a demo cookie
 * from earlier is still in the browser. Real and demo data never share a screen.
 */
export function chooseViewer(visitorId: string | null, session: Session | null): Viewer | null {
  if (session) return { kind: "person", userId: session.userId, session };
  return visitorId ? { kind: "visitor", userId: visitorId } : null;
}

/** The viewer of this request, read once. */
export const currentViewer = cache(async (): Promise<Viewer | null> => chooseViewer(await currentVisitor(), await currentSession()));

/**
 * The viewer a circle screen needs before it reads anything. Without one,
 * the browser goes to renew a session, and from there to sign in.
 */
export async function requireViewer(path: string): Promise<Viewer> {
  const viewer = await currentViewer();
  if (!viewer) redirect(`/auth/refresh?${new URLSearchParams({ next: path }).toString()}`);
  return viewer;
}
