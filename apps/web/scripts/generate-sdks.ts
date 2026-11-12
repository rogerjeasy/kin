/**
 * Generates Kin's API SDKs with APIMatic from the OpenAPI document the server
 * publishes, so the SDKs describe exactly what the API checks.
 *
 *   pnpm --filter @kin/web run sdk:generate [origin]
 *
 * `origin` defaults to the hosted app. The APIMatic key comes from
 * APIMATIC_AUTH_KEY in the root .env and is never written anywhere.
 * Output: sdks/openapi.json, sdks/typescript and sdks/python at the repository root.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_ORIGIN = "https://mzdg4f3stk.us-east-1.awsapprunner.com";
const LANGUAGES = ["typescript", "python"] as const;

const origin = process.argv[2] ?? DEFAULT_ORIGIN;
const key = process.env["APIMATIC_AUTH_KEY"]?.trim();
if (!key) throw new Error("Set APIMATIC_AUTH_KEY in the root .env (your APIMatic account's API key).");

const root = path.resolve(import.meta.dirname, "../../..");
const out = path.join(root, "sdks");

const response = await fetch(new URL("/api/v1/openapi.json", origin));
if (!response.ok) throw new Error(`The OpenAPI document answered ${response.status}.`);
const document = JSON.stringify(await response.json(), null, 2);

// APIMatic reads a project folder whose src/spec holds the API description.
const project = mkdtempSync(path.join(tmpdir(), "kin-apimatic-"));
mkdirSync(path.join(project, "src", "spec"), { recursive: true });
writeFileSync(path.join(project, "src", "spec", "openapi.json"), document);

try {
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "openapi.json"), `${document}\n`);
  for (const language of LANGUAGES) {
    const generated = path.join(project, "out", language);
    // The key is passed as an argument to the child only, never logged.
    execFileSync("npx", ["--yes", "@apimatic/cli@1", "sdk", "generate", `--language=${language}`, `--input=${project}`, `--destination=${generated}`, `--auth-key=${key}`], { stdio: ["ignore", "ignore", "inherit"] });
    const target = path.join(out, language);
    rmSync(target, { recursive: true, force: true });
    // APIMatic nests the SDK one folder deeper, under the language's name.
    cpSync(path.join(generated, language), target, { recursive: true });
    console.log(`Generated the ${language} SDK in sdks/${language}`);
  }
} finally {
  rmSync(project, { recursive: true, force: true });
}
