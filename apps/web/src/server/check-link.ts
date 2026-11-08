import { ShiftError, readCheckLink, useCheckLink as tapCheckLink, type CheckLinkAction, type CheckLinkNext, type CheckLinkResult, type CheckLinkStatus, type Database } from "@kin/db";

import { createRateLimiter, type RateLimiter } from "./model";
import { readCappedText } from "./request-body";

/** The words a person can be given for a tap that did not go through. One for "that link", whatever is wrong with it. */
export type CheckLinkProblem = "link" | "early" | "state" | "short" | "busy" | "unavailable";

/** What the public page may be told of a tap: the shift's times and the first name, never an ID. */
export type PublicCheck = {
  readonly action: CheckLinkAction;
  /** This tap turned the key; `false` when it had already turned. */
  readonly turned: boolean;
  readonly name: string;
  /** The circle's time zone, so the times are told on the circle's clock and not the phone's. */
  readonly timezone: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly checkedInAt: string | null;
  readonly checkedOutAt: string | null;
};

export type CheckLinkReply = { readonly ok: true; readonly check: PublicCheck } | { readonly ok: false; readonly reason: CheckLinkProblem };

/** A token is 43 characters of base64url: the shape the database accepts, so anything else is not worth asking it about. */
export const CHECK_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const MAX_CHECK_LINK_BYTES = 2_048;
/** Twenty taps a minute from one address: a person on a phone needs two, and a guesser is slowed to nothing. */
const TAPS_PER_MINUTE = 20;
const MINUTE_MS = 60_000;

export const checkLinkLimiter = createRateLimiter(TAPS_PER_MINUTE, MINUTE_MS);

export type CheckLinkDeps = {
  readonly tap: (input: { readonly token: string; readonly action: CheckLinkAction }) => Promise<CheckLinkResult>;
  readonly limiter: RateLimiter;
  readonly now: () => number;
};

/** The usual dependencies: the app's own database role and the real limit. */
export function checkLinkDeps(db: () => Database): CheckLinkDeps {
  return { tap: (input) => tapCheckLink(db(), input), limiter: checkLinkLimiter, now: Date.now };
}

const STATUS: Record<CheckLinkProblem, number> = { link: 403, early: 409, state: 409, short: 409, busy: 429, unavailable: 503 };
const HEADERS = { "cache-control": "no-store", "referrer-policy": "no-referrer" } as const;

const reply = (body: CheckLinkReply, status: number): Response => Response.json(body, { status, headers: HEADERS });
const problem = (reason: CheckLinkProblem, status = STATUS[reason]): Response => reply({ ok: false, reason }, status);

/**
 * The address a request came from, for the limit only. Behind App Runner the
 * load balancer appends the caller's address to `x-forwarded-for`, so the last
 * entry is the one it saw and earlier ones are whatever the caller sent. With
 * no header (a local run) everyone shares one bucket, which is the safe side.
 */
export function clientKey(headers: Headers): string {
  const entries = (headers.get("x-forwarded-for") ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
  return entries.at(-1) ?? "unknown";
}

/** A body of exactly a token and an action, or `null`. Anything else, an extra field included, is not a tap. */
export function parseTap(text: string): { readonly token: string; readonly action: CheckLinkAction } | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const { token, action } = row;
  if (Object.keys(row).length !== 2 || typeof token !== "string" || !CHECK_TOKEN.test(token) || (action !== "in" && action !== "out")) return null;
  return { token, action };
}

const REASONS = { refused: "link", not_started: "early", wrong_state: "state", visit_too_short: "short" } as const;

function problemOf(error: unknown): CheckLinkProblem {
  if (error instanceof ShiftError && Object.hasOwn(REASONS, error.reason)) return REASONS[error.reason as keyof typeof REASONS];
  // Only the kind of fault is logged: never the token, which is the secret, or anything read from a body.
  console.error(JSON.stringify({ message: "check_link.unavailable", error: error instanceof Error ? error.name : "unknown" }));
  return "unavailable";
}

/**
 * The one public route: a caregiver taps a link and nobody is signed in. It
 * answers the same way for a token that never existed and one that expired, so
 * it cannot be used to find live links; it is slowed per address; it reads at
 * most two kilobytes; and nothing it logs carries the token. The database does
 * the real checking and holds its own limit on each link.
 */
export async function checkLinkResponse(request: Request, deps: CheckLinkDeps): Promise<Response> {
  const key = clientKey(request.headers);
  if (!deps.limiter.allows(key, deps.now())) return problem("busy");
  deps.limiter.record(key, deps.now());
  const text = await readCappedText(request, MAX_CHECK_LINK_BYTES);
  const tap = text === null ? null : parseTap(text);
  if (tap === null) return problem("link", 400);
  try {
    const result = await deps.tap(tap);
    return reply(
      {
        ok: true,
        check: {
          action: result.action,
          turned: result.turned,
          name: result.memberFirstName,
          timezone: result.timezone,
          startsAt: result.startsAt.toISOString(),
          endsAt: result.endsAt.toISOString(),
          checkedInAt: result.checkedInAt?.toISOString() ?? null,
          checkedOutAt: result.checkedOutAt?.toISOString() ?? null,
        },
      },
      200,
    );
  } catch (error) {
    return problem(problemOf(error));
  }
}

/** What the public page may be told before any tap: the first name, the planned times on the circle's clock, and the one key that fits. Never an ID. */
export type PublicStatus = {
  readonly name: string;
  readonly timezone: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly next: CheckLinkNext;
};

/** The page's first look at a link: the status, or the one reason it has none. A dead token and a wrong one are both `link`. */
export type CheckLinkView = { readonly ok: true; readonly status: PublicStatus } | { readonly ok: false; readonly reason: Extract<CheckLinkProblem, "link" | "busy" | "unavailable"> };

export type CheckLinkStatusDeps = {
  readonly read: (input: { readonly token: string }) => Promise<CheckLinkStatus>;
  readonly limiter: RateLimiter;
  readonly now: () => number;
};

/** The usual dependencies for a look: the app's own database role and the very limit the tap is held to. */
export function checkLinkStatusDeps(db: () => Database): CheckLinkStatusDeps {
  return { read: (input) => readCheckLink(db(), input), limiter: checkLinkLimiter, now: Date.now };
}

/**
 * Looks at a link for the page's first render, with nobody signed in. The
 * database holds no count of looks (the migration says why), so this is where
 * they are slowed: each look is recorded against the caller's address in the
 * same bucket as the taps, before the database is asked, whatever the token. A
 * token that cannot be one is not asked about. Like the route, it answers
 * `link` for every token the database will not show and logs only the kind of
 * any other fault, never the token.
 */
export async function checkLinkStatus(token: string, headers: Headers, deps: CheckLinkStatusDeps): Promise<CheckLinkView> {
  const key = clientKey(headers);
  if (!deps.limiter.allows(key, deps.now())) return { ok: false, reason: "busy" };
  deps.limiter.record(key, deps.now());
  if (!CHECK_TOKEN.test(token)) return { ok: false, reason: "link" };
  try {
    const status = await deps.read({ token });
    return { ok: true, status: { name: status.memberFirstName, timezone: status.timezone, startsAt: status.startsAt.toISOString(), endsAt: status.endsAt.toISOString(), next: status.next } };
  } catch (error) {
    return { ok: false, reason: problemOf(error) === "link" ? "link" : "unavailable" };
  }
}
