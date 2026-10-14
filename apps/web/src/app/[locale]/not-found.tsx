import { locale as currentLocale } from "next/root-params";

import { NoticePage } from "@/components/pages/notice-page";
import { routes } from "@/content/site-routes";
import { getDictionary } from "@/i18n/dictionary";
import { defaultLocale, isLocale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";

export default async function NotFound() {
  // not-found receives no params, so the language comes from the root segment.
  const segment = await currentLocale();
  const locale = isLocale(segment) ? segment : defaultLocale;
  const { notFound } = await getDictionary(locale);

  return (
    <NoticePage
      eyebrow={notFound.eyebrow}
      title={notFound.title}
      text={notFound.text}
      link={{ href: localizedPath(locale, routes.home), label: notFound.link }}
    />
  );
}
