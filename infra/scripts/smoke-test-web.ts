import { readFileSync } from "node:fs";

/**
 * Checks the deployed web app from the outside, after a deploy:
 *   pnpm --filter @kin/infra run smoke -- cdk-outputs.json
 * The address comes from KinWeb's `Url` output. When the deployment also made
 * the phone service (KinVoice, once `kin:voice` is on), its `Url` output is
 * checked too: it answers its health check, and it refuses a request that
 * Twilio did not sign. Each check is retried for a while, because App Runner
 * may still be swapping in the new version.
 */
const outputsFile = process.argv[2] ?? "cdk-outputs.json";
const outputs = JSON.parse(readFileSync(outputsFile, "utf8")) as Record<string, Record<string, string>>;
const base = outputs["KinWeb"]?.["Url"];
if (!base) {
  console.error(`No KinWeb Url in ${outputsFile}.`);
  process.exit(1);
}

type Check = { name: string; base: string; path: string; method?: "GET" | "POST"; expect: (response: Response, body: string) => string | null };

const voiceBase = outputs["KinVoice"]?.["Url"];
const merchantBase = outputs["KinDemoMerchant"]?.["Url"];

const checks: Check[] = [
  { name: "the home page loads", base, path: "/", expect: (r) => (r.status === 200 ? null : `status ${r.status}`) },
  { name: "a translated page loads", base, path: "/fr/pricing", expect: (r) => (r.status === 200 ? null : `status ${r.status}`) },
  {
    name: "the circle's screens need a session",
    base,
    path: "/dashboard",
    expect: (r) => (r.status === 303 && (r.headers.get("location") ?? "").includes("/auth/refresh") ? null : `status ${r.status}, location ${r.headers.get("location")}`),
  },
  {
    name: "sign-in goes to Cognito and comes back to this address",
    base,
    path: "/auth/sign-in?next=/dashboard",
    expect: (r) => {
      const location = r.headers.get("location") ?? "";
      const callback = new URL(location || "https://invalid").searchParams.get("redirect_uri");
      return r.status === 303 && location.includes("/oauth2/authorize") && callback === `${base}/auth/callback`
        ? null
        : `status ${r.status}, redirect_uri ${callback}`;
    },
  },
  // The phone service, when this deployment made one. An unsigned POST is
  // refused whatever the service's address: that proves it is up and that it
  // acts on nothing Twilio did not sign.
  ...(voiceBase === undefined
    ? []
    : [
        { name: "the phone service is healthy", base: voiceBase, path: "/health", expect: (r: Response, body: string) => (r.status === 200 && body === "ok" ? null : `status ${r.status}`) },
        {
          name: "the phone service refuses a request Twilio did not sign",
          base: voiceBase,
          path: "/voice/shift/answer",
          method: "POST" as const,
          expect: (r: Response) => (r.status === 403 ? null : `status ${r.status}`),
        },
      ]),
  // The demo pharmacy, when this deployment made one (KinDemoMerchant, once kin:demoMerchant is on): it is up, and it
  // takes no order Kin's worker did not sign. The unsigned order is refused before its body is read, so it buys nothing.
  ...(merchantBase === undefined
    ? []
    : [
        { name: "the demo pharmacy is healthy", base: merchantBase, path: "/health", expect: (r: Response) => (r.status === 200 ? null : `status ${r.status}`) },
        { name: "the demo pharmacy refuses an order Kin did not sign", base: merchantBase, path: "/orders", method: "POST" as const, expect: (r: Response) => (r.status === 401 ? null : `status ${r.status}`) },
      ]),
];

const ATTEMPTS = 20;
const PAUSE_MS = 15_000;
let failed = false;
for (const check of checks) {
  let problem: string | null = "not tried";
  for (let attempt = 1; attempt <= ATTEMPTS && problem !== null; attempt += 1) {
    try {
      // The phone service reads only form posts, as Twilio sends them, and checks the signature before the body.
      const post = check.method === "POST" ? { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" } : {};
      const response = await fetch(`${check.base}${check.path}`, { ...post, redirect: "manual", signal: AbortSignal.timeout(20_000) });
      problem = check.expect(response, await response.text());
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
    if (problem !== null && attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
  console.log(`${problem === null ? "ok  " : "FAIL"} ${check.name}${problem === null ? "" : `: ${problem}`}`);
  failed ||= problem !== null;
}
const where = [base, voiceBase, merchantBase].filter((each) => each !== undefined).join(" and ");
console.log(failed ? `The deployed app at ${where} failed its smoke test.` : `The deployed app at ${where} is healthy.`);
process.exit(failed ? 1 : 0);
