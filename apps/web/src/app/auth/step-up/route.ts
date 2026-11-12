import { authorizeUrl, createSignInSecrets } from "@kin/auth";
import type { NextRequest } from "next/server";

import { dashboardRoutes } from "@/content/dashboard-routes";
import { localizedPath } from "@/i18n/routing";
import { authConfig } from "@/server/auth/config";
import { signInCookie } from "@/server/auth/cookies";
import { signInPath } from "@/server/auth/next-path";
import { redirectWithCookies } from "@/server/auth/respond";
import { encodeFlow } from "@/server/auth/sign-in-flow";
import { formLocale } from "@/server/form";
import { currentViewer } from "@/server/viewer";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Starts the fresh check that a yes to real money needs. The person is sent
 * to sign in again, from scratch, with a second factor; the callback records
 * their yes to this one proposal only if the same person comes back with
 * proof of it. A POST from Kin's own pages only, so another site cannot start it.
 */
export async function POST(request: NextRequest) {
  const config = authConfig();
  if (request.headers.get("origin") !== config.webOrigin) return new Response(null, { status: 403 });
  const form = await request.formData();
  const locale = formLocale(form);
  const next = localizedPath(locale, dashboardRoutes.approvals);
  const viewer = await currentViewer();
  if (viewer?.kind !== "person") return redirectWithCookies(signInPath(next), config.webOrigin, []);
  const proposalId = form.get("proposal");
  if (typeof proposalId !== "string" || !UUID.test(proposalId)) return redirectWithCookies(next, config.webOrigin, []);
  const secrets = createSignInSecrets();
  const flow = encodeFlow({ ...secrets, next, stepUp: { proposalId, userId: viewer.userId } });
  return redirectWithCookies(authorizeUrl(config, secrets, locale, "sign-in", "step-up"), config.webOrigin, [signInCookie(flow)]);
}
