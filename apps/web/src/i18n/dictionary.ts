import type english from "./dictionaries/en.json";
import type { Locale } from "./locales";

/** English is the source. Every other language must match its structure. */
export type Dictionary = typeof english;

const loaders: Record<Locale, () => Promise<Dictionary>> = {
  en: () => import("./dictionaries/en.json").then((module) => module.default),
  fr: () => import("./dictionaries/fr.json").then((module) => module.default),
  de: () => import("./dictionaries/de.json").then((module) => module.default),
  it: () => import("./dictionaries/it.json").then((module) => module.default),
  es: () => import("./dictionaries/es.json").then((module) => module.default),
  ar: () => import("./dictionaries/ar.json").then((module) => module.default),
  he: () => import("./dictionaries/he.json").then((module) => module.default),
};

export function getDictionary(locale: Locale): Promise<Dictionary> {
  return loaders[locale]();
}
