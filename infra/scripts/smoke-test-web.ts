import { readFileSync } from "node:fs";

/**
 * Checks the deployed web app from the outside, after a deploy:
 *   pnpm --filter @kin/infra run smoke -- cdk-outputs.json
 * The address comes from KinWeb's `Url` output. Each check is retried for a
 * while, because App Runner may still be swapping in the new version.
 */
const outputsFile = process.argv[2] ?? "cdk-outputs.json";
const outputs = JSON.parse(readFileSync(outputsFile, "utf8")) as Record<string, Record<string, string>>;
const base = outputs["KinWeb"]?.["Url"];
if (!base) {
  console.error(`No KinWeb Url in ${outputsFile}.`);
  process.exit(1);
}

type Check = { name: string; path: string; expect: (response: Response) => string | null };

const checks: Check[] = [
  { name: "the home page loads", path: "/", expect: (r) => (r.status === 200 ? null : `status ${r.status}`) },
  { name: "a translated page loads", path: "/fr/pricing", expect: (r) => (r.status === 200 ? null : `status ${r.status}`) },
  {
    name: "the circle's screens need a session",
    path: "/dashboard",
    expect: (r) => (r.status === 303 && (r.headers.get("location") ?? "").includes("/auth/refresh") ? null : `status ${r.status}, location ${r.headers.get("location")}`),
  },
  {
    name: "sign-in goes to Cognito and comes back to this address",
    path: "/auth/sign-in?next=/dashboard",
    expect: (r) => {
      const location = r.headers.get("location") ?? "";
      const callback = new URL(location || "https://invalid").searchParams.get("redirect_uri");
      return r.status === 303 && location.includes("/oauth2/authorize") && callback === `${base}/auth/callback`
        ? null
        : `status ${r.status}, redirect_uri ${callback}`;
    },
  },
];

const ATTEMPTS = 20;
const PAUSE_MS = 15_000;
let failed = false;
for (const check of checks) {
  let problem: string | null = "not tried";
  for (let attempt = 1; attempt <= ATTEMPTS && problem !== null; attempt += 1) {
    try {
      problem = check.expect(await fetch(`${base}${check.path}`, { redirect: "manual", signal: AbortSignal.timeout(20_000) }));
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
    if (problem !== null && attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
  console.log(`${problem === null ? "ok  " : "FAIL"} ${check.name}${problem === null ? "" : `: ${problem}`}`);
  failed ||= problem !== null;
}
console.log(failed ? `The deployed app at ${base} failed its smoke test.` : `The deployed app at ${base} is healthy.`);
process.exit(failed ? 1 : 0);
