import { InvitationError, readInvitationLink, type Database, type InvitationLink } from "@kin/db";

import { CHECK_TOKEN, checkLinkLimiter, clientKey } from "./check-link";
import type { RateLimiter } from "./model";

/**
 * The public page an invitation email links to, opened with nobody signed in.
 * The link is not a credential: it shows who invited whom and nothing else,
 * and joining still needs a sign-in with the verified address. It is still a
 * secret worth keeping, so the page is slowed per address in the same bucket
 * as the other link pages, answers a token that never existed like one that
 * did not parse, and logs nothing that carries it.
 */

export type InvitationLinkProblem = "link" | "busy" | "unavailable";
export type InvitationLinkView = { readonly ok: true; readonly invitation: InvitationLink } | { readonly ok: false; readonly reason: InvitationLinkProblem };

export type InvitationLinkDeps = {
  readonly read: (token: string) => Promise<InvitationLink>;
  readonly limiter: RateLimiter;
  readonly now: () => number;
};

/** The usual dependencies: the app's own database role and the shared link limit. */
export function invitationLinkDeps(db: () => Database): InvitationLinkDeps {
  return { read: (token) => readInvitationLink(db(), token), limiter: checkLinkLimiter, now: Date.now };
}

export async function invitationLinkStatus(token: string, headers: Headers, deps: InvitationLinkDeps): Promise<InvitationLinkView> {
  const key = clientKey(headers);
  if (!deps.limiter.allows(key, deps.now())) return { ok: false, reason: "busy" };
  deps.limiter.record(key, deps.now());
  if (!CHECK_TOKEN.test(token)) return { ok: false, reason: "link" };
  try {
    return { ok: true, invitation: await deps.read(token) };
  } catch (error) {
    if (error instanceof InvitationError) return { ok: false, reason: "link" };
    // Only the kind of fault is logged: never the token.
    console.error(JSON.stringify({ message: "invitation_link.unavailable", error: error instanceof Error ? error.name : "unknown" }));
    return { ok: false, reason: "unavailable" };
  }
}
