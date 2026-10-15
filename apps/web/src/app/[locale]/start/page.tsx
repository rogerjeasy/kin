import type { Metadata } from "next";

import { AccountScreen } from "@/components/account/account-screen";
import { FormFooter } from "@/components/account/form-footer";
import { FormHeading } from "@/components/account/form-heading";
import { DemoButton } from "@/components/shared/demo-button";
import { StartForm } from "@/components/start/start-form";
import { StartSteps } from "@/components/start/start-steps";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { routes } from "@/content/site-routes";
import { pageContext, pageMetadata } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";

const FORM_HEADING_ID = "start-heading";

export function generateMetadata({ params }: PageProps<"/[locale]/start">): Promise<Metadata> {
  return pageMetadata(params, "start");
}

/**
 * Starting a circle begins with the consent rule and an account. The account
 * is created on the identity provider's own page, and the new account then
 * starts its circle. Someone only looking can open the demo instead.
 */
export default async function StartPage({ params }: PageProps<"/[locale]/start">) {
  const { locale, dictionary } = await pageContext(params);
  const { hero, steps, form } = dictionary.startPage;
  const { common } = dictionary;

  return (
    <AccountScreen
      locale={locale}
      common={common}
      eyebrow={hero.eyebrow}
      title={hero.title}
      lede={hero.lede}
      aside={<StartSteps copy={steps} />}
    >
      <FormHeading id={FORM_HEADING_ID} title={form.title} text={form.text} />
      <StartForm labelledBy={FORM_HEADING_ID} copy={form} action="/auth/sign-in" next={localizedPath(locale, dashboardRoutes.overview)} />
      <FormFooter question={form.haveCircle} link={{ href: localizedPath(locale, routes.signIn), label: common.nav.signIn }} />
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-muted-foreground">
        {form.justLooking}
        <DemoButton locale={locale} label={common.nav.demo} size="sm" />
      </p>
    </AccountScreen>
  );
}
