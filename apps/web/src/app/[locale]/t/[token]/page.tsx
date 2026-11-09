import type { Metadata } from "next";
import { headers } from "next/headers";

import { LinkScreen } from "@/components/check-link/link-screen";
import { TrustedVoiceCard } from "@/components/presence-link/trusted-voice-card";
import { fill } from "@/i18n/template";
import { pageContext } from "@/i18n/page-context";
import { databases } from "@/server/database";
import { voiceLinkDeps, voiceLinkStatus } from "@/server/presence-link";

export async function generateMetadata({ params }: PageProps<"/[locale]/t/[token]">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  return { ...dictionary.trustedVoiceLink.meta, robots: { index: false, follow: false, noarchive: true }, referrer: "no-referrer" };
}

/** "Be someone Kin can check with": a family member confirms their number from the text. Public: the link is the credential. */
export default async function TrustedVoiceLinkPage({ params }: PageProps<"/[locale]/t/[token]">) {
  const { locale, dictionary } = await pageContext(params);
  const { token } = await params;
  const view = await voiceLinkStatus(token, await headers(), voiceLinkDeps(() => databases().app));
  const copy = dictionary.trustedVoiceLink;
  const screen = { ...copy, lede: view.ok ? fill(copy.lede, { parent: view.status.parentFirstName }) : copy.body };
  return (
    <LinkScreen locale={locale} dictionary={dictionary} copy={screen}>
      {view.ok ? (
        <TrustedVoiceCard token={token} name={view.status.name} parentFirstName={view.status.parentFirstName} copy={copy} />
      ) : (
        <p role="alert" className="text-xl font-medium text-pretty text-danger">
          {copy.problems[view.reason]}
        </p>
      )}
    </LinkScreen>
  );
}
