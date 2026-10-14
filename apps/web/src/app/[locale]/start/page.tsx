import type { Metadata } from "next";

import { NoticePage } from "@/components/pages/notice-page";
import { routes } from "@/content/site-routes";
import { pageContext, pageMetadata } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";

export function generateMetadata({ params }: PageProps<"/[locale]/start">): Promise<Metadata> {
  return pageMetadata(params, "start");
}

// Accounts are not built yet. This page says so plainly instead of a dead link.
export default async function StartPage({ params }: PageProps<"/[locale]/start">) {
  const { locale, dictionary } = await pageContext(params);
  const { notOpen } = dictionary;

  return (
    <NoticePage
      eyebrow={notOpen.eyebrow}
      title={notOpen.startTitle}
      text={notOpen.text}
      link={{ href: localizedPath(locale, routes.howItWorks), label: notOpen.link }}
    />
  );
}
