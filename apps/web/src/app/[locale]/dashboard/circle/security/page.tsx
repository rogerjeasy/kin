import { ShieldCheckIcon } from "lucide-react";
import type { Metadata } from "next";

import { AuthenticatorSetup } from "@/components/dashboard/security/authenticator-setup";
import { SignInAgainLink } from "@/components/dashboard/security/sign-in-again-link";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { securityRoute } from "@/content/dashboard-routes";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { authenticatorStatus } from "@/server/auth/authenticator";
import { dashboardContext } from "@/server/dashboard-context";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/circle/security">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, description } = dictionary.dashboard.security.meta;
  return { title, description, robots: { index: false, follow: false } };
}

export default async function SecurityPage({ params }: PageProps<"/[locale]/dashboard/circle/security">) {
  const { locale, dictionary, viewer } = await dashboardContext(params, "circle");
  const copy = dictionary.dashboard.security;
  const status = await authenticatorStatus(viewer);
  const signInAgain = <SignInAgainLink next={localizedPath(locale, securityRoute)} label={copy.signInAgain} />;

  return (
    <>
      <PageHeader title={copy.title} lede={copy.lede} />
      <Panel title={copy.panel}>
        <div className="grid min-w-0 gap-5">
          <p className="flex min-w-0 items-start gap-2 text-pretty">
            <ShieldCheckIcon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${status === "enabled" ? "text-positive" : "text-muted-foreground"}`} />
            <span className="min-w-0">{copy.status[status]}</span>
          </p>
          {status === "not_set" ? <AuthenticatorSetup copy={copy} onSignInAgain={signInAgain} /> : null}
          {status === "sign_in_again" ? signInAgain : null}
        </div>
      </Panel>
    </>
  );
}
