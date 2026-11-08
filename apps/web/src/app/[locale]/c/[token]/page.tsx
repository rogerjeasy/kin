import type { Metadata } from "next";
import { headers } from "next/headers";

import { CheckCard } from "@/components/check-link/check-card";
import { CheckResult } from "@/components/check-link/check-result";
import { CheckScreen } from "@/components/check-link/check-screen";
import { pageContext } from "@/i18n/page-context";
import { checkLinkStatus, checkLinkStatusDeps } from "@/server/check-link";
import { databases } from "@/server/database";

export async function generateMetadata({ params }: PageProps<"/[locale]/c/[token]">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  return {
    ...dictionary.checkLink.meta,
    // The address holds a secret: no search engine lists it and no link on it passes it on.
    robots: { index: false, follow: false, noarchive: true },
    referrer: "no-referrer",
  };
}

/**
 * A caregiver's check-in link, opened from a text, a printed code or a tag.
 * Public: the link is the credential. The server looks at the link without
 * turning anything (so no use is counted), names the caregiver, gives the
 * planned time on the circle's clock and offers the one key that fits. A link
 * that is dead, wrong or malformed shows the same generic words. The look is
 * slowed per address, from the request's forwarded address, in the same bucket
 * as the taps. The token is read from the path and never logged.
 */
export default async function CheckLinkPage({ params }: PageProps<"/[locale]/c/[token]">) {
  const { locale, dictionary } = await pageContext(params);
  const { token } = await params;
  const view = await checkLinkStatus(token, await headers(), checkLinkStatusDeps(() => databases().app));
  return (
    <CheckScreen locale={locale} dictionary={dictionary}>
      {view.ok ? <CheckCard token={token} status={view.status} copy={dictionary.checkLink} locale={locale} /> : <CheckResult copy={dictionary.checkLink} locale={locale} outcome={{ problem: view.reason }} />}
    </CheckScreen>
  );
}
