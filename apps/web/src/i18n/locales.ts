export const locales = ["en", "fr", "de", "it", "es", "ar", "he"] as const;

export type Locale = (typeof locales)[number];

export type Direction = "ltr" | "rtl";

export const defaultLocale: Locale = "en";

/** Each language's own name for itself, so a reader can find theirs. */
export const localeNames: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  es: "Español",
  ar: "العربية",
  he: "עברית",
};

const rightToLeft: ReadonlySet<Locale> = new Set(["ar", "he"]);

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function directionOf(locale: Locale): Direction {
  return rightToLeft.has(locale) ? "rtl" : "ltr";
}

/**
 * The locale to hand to Intl formatters. Western digits everywhere, so a
 * formatted amount reads the same as the amounts written in the copy.
 */
export function numberLocaleOf(locale: Locale): string {
  return `${locale}-u-nu-latn`;
}
