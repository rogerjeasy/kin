import { defaultLocale, isLocale, type Locale } from "./locales";

export type LocaleRouting =
  | { kind: "pass" }
  | { kind: "rewrite"; pathname: string }
  | { kind: "redirect"; pathname: string };

/**
 * English lives at the short address (/pricing). Every other language is
 * prefixed (/fr/pricing). Inside the app every route sits under /[locale].
 */
export function routeLocale(pathname: string): LocaleRouting {
  const { locale, rest } = splitLocale(pathname);
  if (locale === undefined) {
    return { kind: "rewrite", pathname: join(defaultLocale, pathname) };
  }
  if (locale === defaultLocale) {
    return { kind: "redirect", pathname: rest };
  }
  return { kind: "pass" };
}

/** The public address of a page in a given language. */
export function localizedPath(locale: Locale, path: string): string {
  return locale === defaultLocale ? path : join(locale, path);
}

/**
 * The page an address points at, without its language. A prerendered page sees
 * the inner address (/en/safety) and the browser sees the public one (/safety).
 * This gives both the same answer.
 */
export function pagePath(pathname: string): string {
  return splitLocale(pathname).rest;
}

/** The public address of the current page in another language. */
export function switchLocale(pathname: string, target: Locale): string {
  return localizedPath(target, pagePath(pathname));
}

function splitLocale(pathname: string): { locale?: Locale; rest: string } {
  const [, first = "", ...others] = pathname.split("/");
  if (!isLocale(first)) {
    return { rest: pathname };
  }
  return { locale: first, rest: `/${others.join("/")}` };
}

function join(locale: Locale, path: string): string {
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}
