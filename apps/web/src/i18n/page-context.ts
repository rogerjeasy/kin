import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { routes, type RouteKey } from "../content/site-routes";
import { getDictionary, type Dictionary } from "./dictionary";
import { defaultLocale, isLocale, locales, type Locale } from "./locales";
import { localizedPath } from "./routing";

type LocaleParams = Promise<{ locale: string }>;

export type PageContext = { locale: Locale; dictionary: Dictionary };

/** What every page and layout needs first: a checked locale and its copy. */
export async function pageContext(params: LocaleParams): Promise<PageContext> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  return { locale, dictionary: await getDictionary(locale) };
}

type MetaKey = keyof Dictionary["meta"];

/** Title, description, and where the same page lives in every language. */
export async function pageMetadata(params: LocaleParams, page: MetaKey & RouteKey): Promise<Metadata> {
  const { locale, dictionary } = await pageContext(params);
  const path = routes[page];
  const languages = Object.fromEntries(locales.map((target) => [target, localizedPath(target, path)]));

  return {
    ...dictionary.meta[page],
    alternates: {
      canonical: localizedPath(locale, path),
      languages: { ...languages, "x-default": localizedPath(defaultLocale, path) },
    },
  };
}
