// Puts the Bryntum Scheduler's script files where the app serves them
// (apps/web/public/vendor/bryntum), named by version. The scripts are loaded by
// the browser at runtime and are never bundled: see
// src/components/dashboard/shifts/bryntum-files.ts. Run as `prebuild` and
// `predev`; it is safe to run again, and it fails if the package is missing.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BRYNTUM_LOCALES,
  BRYNTUM_URL_DIR,
  bryntumLocaleFile,
  bryntumModuleFile,
} from "../src/components/dashboard/shifts/bryntum-files.ts";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC_DIR = join(APP_DIR, "public", BRYNTUM_URL_DIR);

function packageDir(): string {
  const manifest = createRequire(join(APP_DIR, "package.json")).resolve("@bryntum/scheduler/package.json");
  return dirname(manifest);
}

/** The installed version of the Scheduler, the one the served files are named by. */
export function bryntumVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(join(packageDir(), "package.json"), "utf8"));
  const version = typeof manifest === "object" && manifest !== null && "version" in manifest ? manifest.version : undefined;
  if (typeof version !== "string") throw new Error("@bryntum/scheduler has no version in its package.json");
  return version;
}

export function vendorBryntum(): readonly string[] {
  const version = bryntumVersion();
  const from = packageDir();
  mkdirSync(PUBLIC_DIR, { recursive: true });
  const files = [bryntumModuleFile(version), ...BRYNTUM_LOCALES.map((name) => bryntumLocaleFile(version, name))];
  for (const { source, served } of files) {
    // copyFileSync throws when the source is missing, which stops the build.
    copyFileSync(join(from, source), join(PUBLIC_DIR, served));
  }
  return files.map(({ served }) => served);
}

if (import.meta.main) {
  const served = vendorBryntum();
  console.log(`Bryntum ${bryntumVersion()}: ${served.length} files in public${BRYNTUM_URL_DIR}`);
}
