import { timingSafeEqual } from "node:crypto";

import { AuthError, exchangeCode } from "@kin/auth";
import type { NextRequest } from "next/server";

import { withOwedAccountTypes } from "@/server/auth/account-groups";
import { startEnrolment } from "@/server/auth/authenticator";
import { authConfig, sessionVerifier } from "@/server/auth/config";
import { COOKIES, clearedSignInCookie, sessionCookies } from "@/server/auth/cookies";
import { clearedDemoCookie } from "@/server/auth/demo-cookie";
import { signInPath } from "@/server/auth/next-path";
import { redirectWithCookies } from "@/server/auth/respond";
import { decodeFlow } from "@/server/auth/sign-in-flow";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { withNotice } from "@/content/dashboard-notices";
import { approveWithFreshCheck } from "@/server/fresh-approval";

/**
 * Where the identity provider sends the browser back. The answer counts only
 * if it carries the state this browser sent, the code trades with this
 * browser's PKCE verifier, and the tokens prove a session with this
 * sign-in's nonce. Anything else goes back to the sign-in page.
 */
export async function GET(request: NextRequest) {
  const config = authConfig();
  const params = request.nextUrl.searchParams;
  const flow = decodeFlow(request.cookies.get(COOKIES.signIn)?.value);
  const back = (problem: "failed" | "unavailable") =>
    redirectWithCookies(signInPath(flow?.next ?? dashboardRoutes.overview, problem), config.webOrigin, [clearedSignInCookie()]);

  const code = params.get("code");
  const state = params.get("state");
  if (!flow || !code || !state || params.has("error") || !sameSecret(state, flow.state)) {
    return back("failed");
  }

  try {
    const exchanged = await exchangeCode(config, code, flow.verifier);
    const session = await sessionVerifier().verify(exchanged, { nonce: flow.nonce });
    if (!session) return back("failed");
    if (flow.enrol) {
      // These tokens carry the self-service scope: they never become the
      // session. The person keeps the session they had.
      const started = await startEnrolment(session, exchanged, flow.enrol.userId, new Date());
      if ("problem" in started) return redirectWithCookies(`${flow.next}?${new URLSearchParams({ problem: started.problem }).toString()}`, config.webOrigin, [clearedSignInCookie()]);
      return redirectWithCookies(flow.next, config.webOrigin, [clearedSignInCookie(), started.cookie]);
    }
    // The nonce is checked on the tokens of this sign-in; renewed tokens carry the same person and sign-in.
    const { tokens } = await withOwedAccountTypes({ session, tokens: exchanged }, exchanged.refreshToken);
    // Signing in ends any demo in this browser, so the person lands in their own account.
    const cookies = [clearedSignInCookie(), clearedDemoCookie(), ...sessionCookies(tokens)];
    if (!flow.stepUp) return redirectWithCookies(flow.next, config.webOrigin, cookies);
    // A step-up counts only for the person who asked for it. Someone else
    // signing in on this browser is not their yes, and keeps the old session.
    if (session.userId !== flow.stepUp.userId) return redirectWithCookies(withNotice(flow.next, "refused"), config.webOrigin, [clearedSignInCookie()]);
    const notice = await approveWithFreshCheck(session, flow.stepUp.proposalId, new Date());
    return redirectWithCookies(withNotice(flow.next, notice), config.webOrigin, cookies);
  } catch (error) {
    if (error instanceof AuthError) return back(error.retryable ? "unavailable" : "failed");
    throw error;
  }
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
