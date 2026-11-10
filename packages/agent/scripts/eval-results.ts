import { mkdirSync, writeFileSync } from "node:fs";

/**
 * Writes one evaluation's results to evals/results/<name>-<day>.json, so every
 * run against the real model leaves a dated record, and prints the tally.
 * Returns the exit code: 0 when every case passed.
 */
export function writeEvalResults(name: string, run: { readonly prompt: string; readonly model: string; readonly api: string; readonly cases: readonly { readonly passed: boolean }[] }): number {
  const day = new Date().toISOString().slice(0, 10);
  const passed = run.cases.filter((each) => each.passed).length;
  mkdirSync(new URL("../evals/results/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../evals/results/${name}-${day}.json`, import.meta.url), `${JSON.stringify({ date: day, prompt: run.prompt, model: run.model, api: run.api, passed, total: run.cases.length, cases: run.cases }, null, 2)}\n`);
  console.log(`${run.prompt} on ${run.model}: ${passed}/${run.cases.length} passed`);
  return passed === run.cases.length ? 0 : 1;
}
