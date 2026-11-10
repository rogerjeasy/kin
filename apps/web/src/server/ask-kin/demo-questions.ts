import { DEMO_SESSION_DAYS } from "@kin/auth";

import { currentSession } from "../auth/session";
import { createRateLimiter, type Allowance } from "../model";
import type { Viewer } from "../viewer";

/**
 * How many questions a demo visitor who has not signed in may ask Kin in one
 * demo session: enough to try each seat (organizer, sibling, parent,
 * caregiver, observer) and a refusal or two, while the server's hourly demo
 * budget still bounds what the demo can spend (decision 96, amended).
 */
export const DEMO_QUESTIONS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Each demo visitor's questions, counted for as long as their demo session
 * lasts. Kept in this server's memory like the other model limits: it shapes
 * the demo and bounds its cost, and is not a guarantee across instances.
 *
 * Its window is the demo session's fourteen days, so it must never refuse a
 * newcomer for being full: whoever filled it would shut every new visitor out
 * of Ask Kin for two weeks. When full it forgets the visitor who asked least
 * recently instead; spending stays bounded by the server's hourly demo budget.
 *
 * Held on `globalThis` because a production build gives the Ask Kin route and
 * the Ask Kin page their own copy of this module; both must read one count.
 */
const shared = globalThis as typeof globalThis & { kinDemoQuestions?: Allowance };
export const demoQuestions: Allowance = (shared.kinDemoQuestions ??= createRateLimiter(DEMO_QUESTIONS, DEMO_SESSION_DAYS * DAY_MS, { whenFull: "forgetOldest" }));

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
