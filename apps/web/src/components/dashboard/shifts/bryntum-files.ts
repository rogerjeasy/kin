/**
 * Where the Bryntum Scheduler's script files are served from. The module is
 * 4 MB of code that the bundler would analyse and minify on every build, so it
 * is copied beside the app as static files (scripts/vendor-bryntum.ts) and the
 * browser loads it at runtime. The version is in each name: a file never
 * changes under its name, so it can be cached for good.
 */
export const BRYNTUM_URL_DIR = "/vendor/bryntum";

/** Bryntum's locale files for the languages the app speaks (care-calendar-locale.ts). */
export const BRYNTUM_LOCALES = ["En", "FrFr", "De", "Es", "It", "Ar", "He"] as const;
export type BryntumLocaleName = (typeof BRYNTUM_LOCALES)[number];

/** The file's name inside the package, and the name it is served under. */
export type BryntumFile = { readonly source: string; readonly served: string };

export function bryntumModuleFile(version: string): BryntumFile {
  return { source: "scheduler.module.js", served: `scheduler-${version}.module.js` };
}

export function bryntumLocaleFile(version: string, name: BryntumLocaleName): BryntumFile {
  return { source: `locales/scheduler.locale.${name}.js`, served: `scheduler-${version}.locale.${name}.js` };
}

export function bryntumUrl(file: BryntumFile): string {
  return `${BRYNTUM_URL_DIR}/${file.served}`;
}
