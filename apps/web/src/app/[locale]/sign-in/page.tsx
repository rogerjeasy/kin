import type { Metadata } from "next";

import { AccountScreen } from "@/components/account/account-screen";
import { FormFooter } from "@/components/account/form-footer";
import { FormHeading } from "@/components/account/form-heading";
import { SignInPanel } from "@/components/sign-in/sign-in-panel";
import { SignInWays } from "@/components/sign-in/sign-in-ways";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { routes } from "@/content/site-routes";
import { pageContext, pageMetadata } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { safeNextPath } from "@/server/auth/next-path";

const FORM_HEADING_ID = "sign-in-heading";

export function generateMetadata({ params }: PageProps<"/[locale]/sign-in">): Promise<Metadata> {
  return pageMetadata(params, "signIn");
}

function problemOf(value: string | string[] | undefined): "failed" | "unavailable" | null {
  return value === "failed" || value === "unavailable" ? value : null;
}

/**
 * Signing in happens on the identity provider's own page. This screen says
 * how each person gets in, and sends the browser there with where to come
 * back to.
 */
export default async function SignInPage({ params, searchParams }: PageProps<"/[locale]/sign-in">) {
  const { locale, dictionary } = await pageContext(params);
  const query = await searchParams;
  const { hero, ways, form } = dictionary.signInPage;
  const { common } = dictionary;
  const rawNext = typeof query.next === "string" ? query.next : null;
  const next = safeNextPath(rawNext ?? localizedPath(locale, dashboardRoutes.overview));

  return (
    <AccountScreen
      locale={locale}
      common={common}
      eyebrow={hero.eyebrow}
      title={hero.title}
      lede={hero.lede}
      aside={<SignInWays copy={ways} />}
    >
      <FormHeading id={FORM_HEADING_ID} title={form.title} text={form.text} />
      <SignInPanel copy={form} href={`/auth/sign-in?${new URLSearchParams({ next }).toString()}`} problem={problemOf(query.problem)} />
      <FormFooter question={form.noCircle} link={{ href: localizedPath(locale, routes.start), label: common.nav.start }} />
    </AccountScreen>
  );
}
