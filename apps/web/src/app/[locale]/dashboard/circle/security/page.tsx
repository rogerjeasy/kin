import { ShieldCheckIcon } from "lucide-react";
import type { Metadata } from "next";

import { AuthenticatorSetup } from "@/components/dashboard/security/authenticator-setup";
import { StartEnrolmentForm } from "@/components/dashboard/security/start-enrolment-form";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { pageContext } from "@/i18n/page-context";
import { authenticatorScreen } from "@/server/auth/authenticator";
import { dashboardContext } from "@/server/dashboard-context";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/circle/security">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, description } = dictionary.dashboard.security.meta;
  return { title, description, robots: { index: false, follow: false } };
}

export default async function SecurityPage({ params, searchParams }: PageProps<"/[locale]/dashboard/circle/security">) {
  const { locale, dictionary, viewer } = await dashboardContext(params, "circle");
  const copy = dictionary.dashboard.security;
  const screen = await authenticatorScreen(viewer);
  const raw = (await searchParams)["problem"];
  const problem = typeof raw === "string" && raw in copy.errors ? (raw as keyof typeof copy.errors) : null;
  const start = (label: string) => <StartEnrolmentForm locale={locale} label={label} />;

  return (
    <>
      <PageHeader title={copy.title} lede={copy.lede} />
      <Panel title={copy.panel}>
        <div className="grid min-w-0 gap-5">
          <p className="flex min-w-0 items-start gap-2 text-pretty">
            <ShieldCheckIcon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${screen.status === "enabled" ? "text-positive" : "text-muted-foreground"}`} />
            <span className="min-w-0">{copy.status[screen.status]}</span>
          </p>
          {problem !== null && screen.status !== "pending" ? (
            <p role="alert" className="text-sm text-pretty text-danger">
              {copy.errors[problem]}
            </p>
          ) : null}
          {screen.status === "not_set" ? (
            <div className="grid min-w-0 gap-2">
              {start(copy.begin)}
              <p className="text-sm text-pretty text-muted-foreground">{copy.beginHint}</p>
            </div>
          ) : null}
          {screen.status === "pending" ? <AuthenticatorSetup copy={copy} locale={locale} secret={screen.secret} qr={screen.qr} startAgain={start(copy.startAgain)} /> : null}
        </div>
      </Panel>
    </>
  );
}
