import type { Metadata } from "next";
import { headers } from "next/headers";

import { LinkScreen } from "@/components/check-link/link-screen";
import { PresenceCard } from "@/components/presence-link/presence-card";
import { pageContext } from "@/i18n/page-context";
import { databases } from "@/server/database";
import { presenceLinkDeps, presenceLinkStatus } from "@/server/presence-link";

export async function generateMetadata({ params }: PageProps<"/[locale]/v/[token]">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  return {
    ...dictionary.presenceLink.meta,
    // The address holds a secret: no search engine lists it and no link on it passes it on.
    robots: { index: false, follow: false, noarchive: true },
    referrer: "no-referrer",
  };
}

/**
 * "Is this you?", opened from a text on a family member's own phone. Public:
 * the link is the credential. The server looks at the check without answering
 * it, so nothing changes until a tap; a link that is dead, wrong or malformed
 * shows the same generic words. The page is slowed per address, and the token
 * is read from the path and never logged.
 */
export default async function PresenceLinkPage({ params }: PageProps<"/[locale]/v/[token]">) {
  const { locale, dictionary } = await pageContext(params);
  const { token } = await params;
  const view = await presenceLinkStatus(token, await headers(), presenceLinkDeps(() => databases().app));
  const copy = dictionary.presenceLink;
  return (
    <LinkScreen locale={locale} dictionary={dictionary} copy={copy}>
      {view.ok ? (
        <PresenceCard token={token} status={view.status} copy={copy} locale={locale} />
      ) : (
        <p role="alert" className="text-xl font-medium text-pretty text-danger">
          {copy.problems[view.reason]}
        </p>
      )}
    </LinkScreen>
  );
}
