import { DEMO_SESSION_DAYS } from "@kin/auth";

import { currentSession } from "../auth/session";
import { createRateLimiter, type Allowance } from "../model";
import type { Viewer } from "../viewer";

/** How many questions a demo visitor who has not signed in may ask Kin in one demo session. */
export const DEMO_QUESTIONS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Each demo visitor's questions, counted for as long as their demo session
 * lasts. Kept in this server's memory like the other model limits: it shapes
 * the demo and bounds its cost, and is not a guarantee across instances.
 *
 * Held on `globalThis` because a production build gives the Ask Kin route and
 * the Ask Kin page their own copy of this module; both must read one count.
 */
const shared = globalThis as typeof globalThis & { kinDemoQuestions?: Allowance };
export const demoQuestions: Allowance = (shared.kinDemoQuestions ??= createRateLimiter(DEMO_QUESTIONS, DEMO_SESSION_DAYS * DAY_MS));

/**
 * The allowance this viewer's questions count against: a demo visitor's,
 * unless they have also signed in. A person who signed in asks without it,
 * in the demo as in their own circle.
 */
export async function questionAllowanceFor(viewer: Viewer): Promise<Allowance | undefined> {
  if (viewer.kind === "person") return undefined;
  return (await currentSession()) === null ? demoQuestions : undefined;
}

/** What is left of an allowance for this person now, or `null` when they have none to count. */
export function questionsLeft(allowance: Allowance | undefined, userId: string, now: number): number | null {
  return allowance === undefined ? null : Math.max(0, allowance.limit - allowance.used(userId, now));
}
