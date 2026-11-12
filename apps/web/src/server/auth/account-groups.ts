import { accountTypesOwed, refreshTokens, type Session, type TokenSet } from "@kin/auth";
import type { CognitoAdmin } from "@kin/auth/cognito-admin";
import { readAccountGroupsEnabled } from "@kin/config";

import { joinInvitedCircles } from "../circle";
import { authConfig, sessionVerifier } from "./config";
import { poolAdmin } from "./pool-admin";

/** A verified session and the tokens that prove it. */
export type SignedIn = { readonly session: Session; readonly tokens: TokenSet };

/** The user pool, or `null` where this server may not change its groups. */
function accountGroups(): CognitoAdmin | null {
  return readAccountGroupsEnabled(process.env) ? poolAdmin() : null;
}

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown");

/**
 * Gives a person the account types they are owed, as `accountTypesOwed`
 * decides from the seats they hold, once they have joined the circles that
 * invited them. A group is in a token only from the next one Cognito issues,
 * so when any was added the tokens are renewed at once, here, and the person
 * never sees a screen refuse them for a type they now hold.
 *
 * Any failure leaves the person signed in with what their tokens already
 * say. Fewer account types is the safe side: a screen that needs one stays
 * refused, and the next sign-in or renewal tries again.
 */
export async function withOwedAccountTypes(signedIn: SignedIn, refreshToken: string | null): Promise<SignedIn> {
  const pool = accountGroups();
  if (pool === null || refreshToken === null) return signedIn;
  const { session } = signedIn;
  try {
    const seats = await joinInvitedCircles(session);
    const owed = accountTypesOwed(session.accountTypes, seats);
    if (owed.length === 0) return signedIn;
    for (const type of owed) await pool.grant(session.userId, type);
    const renewed = await refreshTokens(authConfig(), refreshToken);
    const after = await sessionVerifier().verify(renewed);
    if (after === null || after.userId !== session.userId) return signedIn;
    console.info(JSON.stringify({ message: "account_types.granted", types: owed.join(",") }));
    // A renewal brings no new refresh token: the one in hand stays valid.
    return { session: after, tokens: { ...renewed, refreshToken: signedIn.tokens.refreshToken } };
  } catch (error) {
    console.error(JSON.stringify({ message: "account_types.not_granted", error: errorName(error) }));
    return signedIn;
  }
}
