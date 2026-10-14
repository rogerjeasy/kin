import type { Metadata } from "next";

import { AccountForm } from "@/components/account/account-form";
import { AccountScreen } from "@/components/account/account-screen";
import { FormFooter } from "@/components/account/form-footer";
import { FormHeading } from "@/components/account/form-heading";
import { SignInWays } from "@/components/sign-in/sign-in-ways";
import { EXAMPLE_EMAIL } from "@/content/example-email";
import { routes } from "@/content/site-routes";
import { pageContext, pageMetadata } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";

const FORM_HEADING_ID = "sign-in-heading";

export function generateMetadata({ params }: PageProps<"/[locale]/sign-in">): Promise<Metadata> {
  return pageMetadata(params, "signIn");
}

// Accounts are not built yet. The screen is the real one, with the one field
// passwordless sign-in needs. Until sign-in exists, the form answers that it
// is not open and sends nothing.
export default async function SignInPage({ params }: PageProps<"/[locale]/sign-in">) {
  const { locale, dictionary } = await pageContext(params);
  const { hero, ways, form } = dictionary.signInPage;
  const { common, account, notOpen } = dictionary;

  return (
    <AccountScreen
      locale={locale}
      common={common}
      eyebrow={hero.eyebrow}
      title={hero.title}
      lede={hero.lede}
      aside={<SignInWays copy={ways} />}
    >
      <FormHeading id={FORM_HEADING_ID} title={form.title} text={form.text} status={notOpen.eyebrow} />
      <AccountForm
        labelledBy={FORM_HEADING_ID}
        fields={[
          {
            name: "email",
            label: account.emailLabel,
            type: "email",
            autoComplete: "email",
            placeholder: EXAMPLE_EMAIL,
            error: fill(account.emailError, { example: EXAMPLE_EMAIL }),
          },
        ]}
        submit={form.submit}
        alternative={{ divider: form.or, label: form.passkey }}
        closed={{ title: notOpen.signInTitle, text: notOpen.text }}
      />
      <FormFooter question={form.noCircle} link={{ href: localizedPath(locale, routes.start), label: common.nav.start }} />
    </AccountScreen>
  );
}
