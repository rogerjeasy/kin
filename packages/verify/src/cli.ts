#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { BundleFormatError, parseBundle } from "./bundle.ts";
import { renderVerdict } from "./verdict.ts";
import { verifyBundle } from "./verify.ts";

const USAGE = "Usage: kin-verify <export.json> [--head <hash written down earlier>] [--json]";

/** Exit code 0 when the export verifies, 1 when it does not, 2 when it cannot be read. */
function main(argv: readonly string[]): number {
  const { values, positionals } = parseArgs({ args: [...argv], allowPositionals: true, options: { head: { type: "string" }, json: { type: "boolean" } } });
  const [path] = positionals;
  if (path === undefined || positionals.length > 1) {
    console.error(USAGE);
    return 2;
  }
  try {
    const report = verifyBundle(parseBundle(readFileSync(path, "utf8")), values.head === undefined ? {} : { expectedHead: values.head });
    console.log(values.json ? JSON.stringify(report, null, 2) : renderVerdict(report));
    return report.ok ? 0 : 1;
  } catch (error) {
    if (error instanceof BundleFormatError) {
      console.error(error.message);
      return 2;
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      console.error(`No such file: ${path}`);
      return 2;
    }
    throw error;
  }
}

process.exitCode = main(process.argv.slice(2));
