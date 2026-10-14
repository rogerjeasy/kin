import type { Metadata } from "next";

import { AccountForm } from "@/components/account/account-form";
import { AccountScreen } from "@/components/account/account-screen";
import { FormFooter } from "@/components/account/form-footer";
import { FormHeading } from "@/components/account/form-heading";
import { StartSteps } from "@/components/start/start-steps";
import { EXAMPLE_EMAIL } from "@/content/example-email";
import { routes } from "@/content/site-routes";
import { pageContext, pageMetadata } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";

const FORM_HEADING_ID = "start-heading";

export function generateMetadata({ params }: PageProps<"/[locale]/start">): Promise<Metadata> {
  return pageMetadata(params, "start");
}

// Accounts are not built yet. The screen is the real one: who is starting the
// circle, who it is for, and the consent rule. Until circles exist, the form
// answers that they are not open and sends nothing.
export default async function StartPage({ params }: PageProps<"/[locale]/start">) {
  const { locale, dictionary } = await pageContext(params);
  const { hero, steps, form } = dictionary.startPage;
  const { common, account, notOpen } = dictionary;

  return (
    <AccountScreen
      locale={locale}
      common={common}
      eyebrow={hero.eyebrow}
      title={hero.title}
      lede={hero.lede}
      aside={<StartSteps copy={steps} />}
    >
      <FormHeading id={FORM_HEADING_ID} title={form.title} text={form.text} status={notOpen.eyebrow} />
      <AccountForm
        labelledBy={FORM_HEADING_ID}
        fields={[
          {
            name: "name",
            label: form.nameLabel,
            type: "text",
            autoComplete: "name",
            placeholder: common.people.elena,
            error: account.requiredError,
          },
          {
            name: "email",
            label: account.emailLabel,
            type: "email",
            autoComplete: "email",
            placeholder: EXAMPLE_EMAIL,
            error: fill(account.emailError, { example: EXAMPLE_EMAIL }),
          },
          {
            name: "parent",
            label: form.parentLabel,
            type: "text",
            autoComplete: "off",
            placeholder: common.people.rose,
            help: form.parentHelp,
            error: account.requiredError,
          },
        ]}
        consent={{ label: form.consent, error: form.consentError }}
        submit={form.submit}
        closed={{ title: notOpen.startTitle, text: notOpen.text }}
      />
      <FormFooter question={form.haveCircle} link={{ href: localizedPath(locale, routes.signIn), label: common.nav.signIn }} />
    </AccountScreen>
  );
}
