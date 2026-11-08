type Entry = { readonly name: string; readonly load: () => Promise<unknown> };

const ENGLISH: Entry = { name: "En", load: () => import("@bryntum/scheduler/locales/scheduler.locale.En.js") };

/** The languages the app speaks, each with Bryntum's locale file for it. */
const LOADERS: Record<string, Entry> = {
  en: ENGLISH,
  fr: { name: "FrFr", load: () => import("@bryntum/scheduler/locales/scheduler.locale.FrFr.js") },
  de: { name: "De", load: () => import("@bryntum/scheduler/locales/scheduler.locale.De.js") },
  es: { name: "Es", load: () => import("@bryntum/scheduler/locales/scheduler.locale.Es.js") },
  it: { name: "It", load: () => import("@bryntum/scheduler/locales/scheduler.locale.It.js") },
  ar: { name: "Ar", load: () => import("@bryntum/scheduler/locales/scheduler.locale.Ar.js") },
  he: { name: "He", load: () => import("@bryntum/scheduler/locales/scheduler.locale.He.js") },
};

/** The entry for a BCP-47 tag such as "fr-CA": its language decides, and anything unknown is English. */
export function localeFor(tag: string): Entry {
  const language = tag.toLowerCase().split("-")[0] ?? "en";
  return LOADERS[language] ?? ENGLISH;
}

/** Loads a language's strings and makes them the scheduler's own. */
export async function applyLocale(tag: string): Promise<void> {
  const { name, load } = localeFor(tag);
  // The library is loaded here, not at the top, so the pure part of this file runs in a test.
  const { LocaleManager } = await import("@bryntum/scheduler");
  await load();
  await LocaleManager.applyLocale(name);
}
