import { bryntumLocaleFile, bryntumUrl, type BryntumLocaleName } from "./bryntum-files.ts";
import { bryntumVersion, type BryntumModule } from "./bryntum-runtime.ts";

type Entry = { readonly name: BryntumLocaleName };

const ENGLISH: Entry = { name: "En" };

/** The languages the app speaks, each with Bryntum's locale name for it. */
const LOCALES: Record<string, Entry> = {
  en: ENGLISH,
  fr: { name: "FrFr" },
  de: { name: "De" },
  es: { name: "Es" },
  it: { name: "It" },
  ar: { name: "Ar" },
  he: { name: "He" },
};

/** The entry for a BCP-47 tag such as "fr-CA": its language decides, and anything unknown is English. */
export function localeFor(tag: string): Entry {
  const language = tag.toLowerCase().split("-")[0] ?? "en";
  return LOCALES[language] ?? ENGLISH;
}

const scripts = new Map<BryntumLocaleName, Promise<void>>();

/**
 * A locale file is a script that registers its strings with the library
 * already loaded. It also leaves a stray `default` on the global object, which
 * is removed again unless something else put it there first.
 */
async function loadLocaleScript(name: BryntumLocaleName): Promise<void> {
  const hadDefault = "default" in globalThis;
  await import(/* webpackIgnore: true */ bryntumUrl(bryntumLocaleFile(bryntumVersion(), name)));
  if (!hadDefault) Reflect.deleteProperty(globalThis, "default");
}

function localeScript(name: BryntumLocaleName): Promise<void> {
  const known = scripts.get(name);
  if (known) return known;
  const loading = loadLocaleScript(name).catch((error: unknown) => {
    scripts.delete(name);
    throw error;
  });
  scripts.set(name, loading);
  return loading;
}

/** Loads a language's strings and makes them the scheduler's own. */
export async function applyLocale(bryntum: BryntumModule, tag: string): Promise<void> {
  const { name } = localeFor(tag);
  await localeScript(name);
  await bryntum.LocaleManager.applyLocale(name);
}
