import { DELEGATION_LIFETIME_DAYS } from "@kin/auth";
import type { Metadata } from "next";
import Link from "next/link";

import { AgencyPanel } from "@/components/dashboard/connections/agency-panel";
import { BoundaryList } from "@/components/dashboard/connections/boundary-list";
import { DelegationCard } from "@/components/dashboard/connections/delegation-card";
import { GrantForm } from "@/components/dashboard/connections/grant-form";
import { LiveConsole } from "@/components/dashboard/connections/live-console";
import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { waitingProposals } from "@/content/circle/proposal-view";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { delegationViews, reportViews } from "@/content/open-kin/connection-views";
import { routes } from "@/content/site-routes";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { authConfig } from "@/server/auth/config";
import { dashboardContext, may } from "@/server/dashboard-context";
import { databases } from "@/server/database";
import { connectionsScreen } from "@/server/open-kin/connections";
import { MCP_PATH } from "@/server/open-kin/mcp";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/circle/connections">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, description } = dictionary.openKin.meta;
  return { title, description, robots: { index: false, follow: false } };
}

export default async function ConnectionsPage({ params }: PageProps<"/[locale]/dashboard/circle/connections">) {
  const { locale, dictionary, circle, viewer } = await dashboardContext(params, "circle");
  const copy = dictionary.openKin;
  const format = circleFormatters(locale, circle);
  const names = circleNames(circle, dictionary);
  const origin = authConfig().webOrigin;
  const screen = await connectionsScreen({ db: databases().app, userId: viewer.userId, circle });
  // A delegation lives on the real clock, as the server decides when its token is used.
  const now = new Date();
  const delegations = delegationViews({ delegations: screen.delegations, circle, names, format, now });
  const reports = reportViews({ reports: screen.reports, keys: screen.agencyKeys, circle, copy: copy.agency, kinds: dictionary.dashboard.shifts.kinds, format });
  const keys = screen.agencyKeys.map((key) => ({ id: key.id, label: key.label, created: format.dateTime(key.createdAt), lastReport: key.lastUsedAt === null ? null : format.dateTime(key.lastUsedAt), revoked: key.revokedAt !== null, seeded: key.seeded }));
  const caregiver = circle.members.find((member) => member.role === "caregiver")?.displayName ?? dictionary.dashboard.common.roles.caregiver;
  const [waiting] = waitingProposals(circle);

  return (
    <>
      <PageHeader
        title={copy.title}
        lede={copy.lede}
        actions={
          <Button asChild variant="outline" size="sm" className="h-auto min-h-11 w-full py-2 text-wrap sm:w-auto">
            <Link href={localizedPath(locale, routes.developers)}>{copy.developersLink}</Link>
          </Button>
        }
      />
      <BoundaryList copy={copy.boundary} />
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title={copy.console.title} description={copy.console.lede}>
          {circle.circle.demo ? (
            <LiveConsole copy={copy.console} endpoint={`${origin}${MCP_PATH}`} seatName={names.member(circle.viewer.memberId)} waitingProposalId={waiting?.proposal.id ?? null} />
          ) : (
            <EmptyState text={copy.console.demoOnly} />
          )}
        </Panel>
        <Panel title={copy.grant.title} description={copy.grant.lede}>
          {may(circle, "delegation.grant") ? <GrantForm copy={copy.grant} tokenCopy={copy.token} lifetimes={DELEGATION_LIFETIME_DAYS} /> : <p className="text-sm text-muted-foreground">{copy.grant.observer}</p>}
        </Panel>
      </div>
      <Panel title={copy.list.title} description={copy.list.lede}>
        {delegations.length === 0 ? (
          <EmptyState text={copy.list.empty} />
        ) : (
          <ul className="grid min-w-0 gap-4 lg:grid-cols-2">
            {delegations.map((delegation) => (
              <DelegationCard key={delegation.id} delegation={delegation} copy={copy.list} toolLabels={dictionary.askKin.tools} />
            ))}
          </ul>
        )}
      </Panel>
      {may(circle, "money.view") || reports.length > 0 ? (
        <AgencyPanel copy={copy} keys={keys} reports={reports} canManage={may(circle, "agency_key.manage")} origin={origin} caregiver={caregiver} shiftsHref={localizedPath(locale, dashboardRoutes.shifts)} />
      ) : null}
    </>
  );
}
