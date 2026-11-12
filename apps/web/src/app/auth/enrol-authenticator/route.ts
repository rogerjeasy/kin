import { authorizeUrl, createSignInSecrets } from "@kin/auth";
import type { NextRequest } from "next/server";

import { securityRoute } from "@/content/dashboard-routes";
import { localizedPath } from "@/i18n/routing";
import { mayStartEnrolment } from "@/server/auth/authenticator";
import { authConfig } from "@/server/auth/config";
import { signInCookie } from "@/server/auth/cookies";
import { signInPath } from "@/server/auth/next-path";
import { redirectWithCookies } from "@/server/auth/respond";
import { encodeFlow } from "@/server/auth/sign-in-flow";
import { formLocale } from "@/server/form";
import { currentViewer } from "@/server/viewer";

/**
 * Starts setting up an authenticator app. A session, however recent, is not
 * enough to change an account's second factor: the person is sent to sign in
 * again from scratch, and the callback goes on only if the same person comes
 * back within minutes. A POST from Kin's own pages only, so another site
 * cannot start it.
 */
export async function POST(request: NextRequest) {
  const config = authConfig();
  if (request.headers.get("origin") !== config.webOrigin) return new Response(null, { status: 403 });
  const locale = formLocale(await request.formData());
  const next = localizedPath(locale, securityRoute);
  const viewer = await currentViewer();
  if (viewer?.kind !== "person") return redirectWithCookies(signInPath(next), config.webOrigin, []);
  const problem = await mayStartEnrolment(viewer.userId);
  if (problem !== null) return redirectWithCookies(`${next}?${new URLSearchParams({ problem }).toString()}`, config.webOrigin, []);
  const secrets = createSignInSecrets();
  const flow = encodeFlow({ ...secrets, next, enrol: { userId: viewer.userId } });
  return redirectWithCookies(authorizeUrl(config, secrets, locale, "sign-in", "enrolment"), config.webOrigin, [signInCookie(flow)]);
}
