import { DELEGATION_LIFETIME_DAYS } from "@kin/auth";
import type { Metadata } from "next";

import { OAuthClientPanel } from "@/components/dashboard/connections/oauth-client-panel";
import { OAuthConsentForm } from "@/components/dashboard/connections/oauth-consent-form";
import { OAuthNotice } from "@/components/dashboard/connections/oauth-notice";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { oauthConsentRoute } from "@/content/dashboard-routes";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { authConfig } from "@/server/auth/config";
import { signInPath } from "@/server/auth/next-path";
import { dashboardContext, may } from "@/server/dashboard-context";
import { checkAuthorization, oauthClients } from "@/server/open-kin/oauth";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/circle/connections/authorize">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, description } = dictionary.openKin.oauth.meta;
  return { title, description, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** The query exactly as the client sent it, each value in its place, so the answer is checked against the same request. */
function queryOf(searchParams: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    for (const each of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(name, each);
  }
  return query.toString();
}

/**
 * The OAuth consent screen (decision 111): an outside assistant asks to work
 * with the circle as this member. The member sees who asks and where the
 * answer goes, chooses the scope and the lifetime, and says yes or no. Only a
 * person who signed in, in a real circle, in a seat that may connect an
 * assistant, is asked at all.
 */
export default async function OAuthConsentPage({ params, searchParams }: PageProps<"/[locale]/dashboard/circle/connections/authorize">) {
  const { locale, dictionary, circle, viewer } = await dashboardContext(params, "circle");
  const copy = dictionary.openKin.oauth;
  const query = queryOf(await searchParams);
  const origin = authConfig().webOrigin;
  const check = await checkAuthorization(new URLSearchParams(query), { origin, clients: oauthClients() });

  if (viewer.kind !== "person") {
    const signIn = signInPath(`${localizedPath(locale, oauthConsentRoute)}?${query}`);
    return <OAuthNotice title={copy.visitor.title} text={copy.visitor.text} action={{ href: signIn, label: copy.visitor.signIn }} />;
  }
  // A request the authorization endpoint would have refused or sent back: nothing to ask about.
  if (check.kind !== "ask") return <OAuthNotice title={copy.invalid.title} text={copy.invalid.text} />;
  if (circle.circle.demo) return <OAuthNotice title={copy.invalid.title} text={copy.errors.demo_only} />;

  const { client, request } = check;
  const name = client.name ?? new URL(request.redirectUri).host;
  const canGrant = may(circle, "delegation.grant");
  return (
    <>
      <PageHeader title={fill(copy.title, { client: name })} lede={copy.lede} />
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <OAuthClientPanel copy={copy} client={client} redirectUri={request.redirectUri} circleName={circle.circle.name} seat={dictionary.dashboard.common.roles[circle.viewer.role]} />
        <Panel title={copy.choose} description={copy.never}>
          <OAuthConsentForm
            copy={copy}
            scopes={dictionary.openKin.grant.scopes}
            lifetimeCopy={{ label: dictionary.openKin.grant.lifetime, day: dictionary.openKin.grant.day, days: dictionary.openKin.grant.days }}
            scopeLabel={dictionary.openKin.grant.scope}
            lifetimes={DELEGATION_LIFETIME_DAYS}
            query={query}
            requested={request.scope}
            canGrant={canGrant}
            observerText={dictionary.openKin.grant.observer}
          />
        </Panel>
      </div>
    </>
  );
}
