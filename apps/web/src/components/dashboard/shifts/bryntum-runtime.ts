import type * as BryntumTypes from "@bryntum/scheduler";

import { bryntumModuleFile, bryntumUrl } from "./bryntum-files.ts";

/** What the Scheduler's module exports. Only types come from the package: the code itself is loaded below, never bundled. */
export type BryntumModule = typeof BryntumTypes;

let loading: Promise<BryntumModule> | undefined;

function isBryntumModule(value: unknown): value is BryntumModule {
  if (typeof value !== "object" || value === null) return false;
  const classes = ["Scheduler", "AnthropicPlugin", "EventModel", "Store", "TimeRangeModel"];
  // LocaleManager is a static object, not a class.
  return classes.every((name) => typeof Reflect.get(value, name) === "function") && typeof Reflect.get(value, "LocaleManager") === "object";
}

/** The installed version, put in the build's environment by next.config.ts. */
export function bryntumVersion(): string {
  const installed = process.env.NEXT_PUBLIC_BRYNTUM_VERSION;
  if (!installed) throw new Error("The Bryntum version is not set; next.config.ts sets it");
  return installed;
}

async function importModule(): Promise<BryntumModule> {
  // webpackIgnore leaves this import as written: the browser fetches the file at runtime and the bundler never parses it.
  const loaded: unknown = await import(/* webpackIgnore: true */ bryntumUrl(bryntumModuleFile(bryntumVersion())));
  if (!isBryntumModule(loaded)) throw new Error("The Bryntum module did not export what the calendar needs");
  return loaded;
}

/** Loads the Scheduler once, in the browser. A failed load is not remembered, so the next try asks again. */
export function loadBryntum(): Promise<BryntumModule> {
  loading ??= importModule().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}
