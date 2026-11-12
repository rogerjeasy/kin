import type { Metadata } from "next";
import { headers } from "next/headers";

import { LinkScreen } from "@/components/check-link/link-screen";
import { InvitationCard } from "@/components/invitation-link/invitation-card";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { fill } from "@/i18n/template";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { databases } from "@/server/database";
import { invitationLinkDeps, invitationLinkStatus } from "@/server/invitation-link";

export async function generateMetadata({ params }: PageProps<"/[locale]/join/[token]">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  return { ...dictionary.joinLink.meta, robots: { index: false, follow: false, noarchive: true }, referrer: "no-referrer" };
}

/**
 * The page an invitation email opens: who invited the person, to whose circle
 * and as what, and the way in. Public: the link shows the invitation and
 * grants nothing. The circle opens after a sign-in with the invited address.
 */
export default async function JoinPage({ params }: PageProps<"/[locale]/join/[token]">) {
  const { locale, dictionary } = await pageContext(params);
  const { token } = await params;
  const view = await invitationLinkStatus(token, await headers(), invitationLinkDeps(() => databases().app));
  const copy = dictionary.joinLink;
  const next = new URLSearchParams({ next: localizedPath(locale, dashboardRoutes.overview) });
  const lede = !view.ok
    ? copy.privacy
    : fill(view.invitation.parentFirstName === "" ? copy.ledeNoParent : copy.lede, {
        inviter: view.invitation.inviterFirstName,
        parent: view.invitation.parentFirstName,
        role: copy.roles[view.invitation.role],
      });
  return (
    <LinkScreen locale={locale} dictionary={dictionary} copy={{ ...copy, lede }}>
      {view.ok ? (
        <InvitationCard state={view.invitation.state} copy={copy} signInHref={`/auth/sign-in?${next.toString()}`} signUpHref={`/auth/sign-in?${next.toString()}&screen=sign-up`} />
      ) : (
        <p role="alert" className="text-xl font-medium text-pretty text-danger">
          {copy.problems[view.reason]}
        </p>
      )}
    </LinkScreen>
  );
}
