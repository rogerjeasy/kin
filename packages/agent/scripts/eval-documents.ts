// The fixed evaluation set for the document-reading prompt (AGENTS.md section 7).
// Runs every case, typed text or a photograph, against the configured model and
// compares the fields it read with the expected ones, exactly, and writes the
// results to evals/results. Calls the real model, so it costs money:
//   KIN_BEDROCK_REGION=us-east-1 AWS_PROFILE=... pnpm --filter @kin/agent run eval:documents
import { readFileSync } from "node:fs";

import { readModelConfig } from "@kin/config";

import { bedrockModel } from "../src/bedrock-model.ts";
import { DOCUMENT_PROMPT_VERSION } from "../src/document-prompt.ts";
import { readDocument } from "../src/read-document.ts";
import type { StructuredImage } from "../src/structured-model.ts";
import { writeEvalResults } from "./eval-results.ts";

type Expect = { kind: string; sender: string | null; amount: string | null; dueOn: string | null; pressure: boolean };
/** A case gives the document's words, or a photograph of it (a PNG path under evals/). */
type Case = { name: string; text?: string; image?: string; expect: Expect };
type Suite = { today: string; currency: string; cases: Case[] };

const suite = JSON.parse(readFileSync(new URL("../evals/documents.json", import.meta.url), "utf8")) as Suite;
const config = readModelConfig(process.env);
if (!config.enabled) throw new Error("Set KIN_BEDROCK_REGION (and AWS credentials) to run the evaluation");
const model = bedrockModel(config);

const photograph = (path: string): StructuredImage => ({ mediaType: "image/png", base64: readFileSync(new URL(`../evals/${path}`, import.meta.url)).toString("base64") });

const results = [];
for (const each of suite.cases) {
  const result = await readDocument(model, { text: each.text ?? null, image: each.image === undefined ? null : photograph(each.image), today: suite.today, currency: suite.currency });
  const got = result.kind === "read" ? { kind: result.reading.kind, sender: result.reading.sender, amount: result.reading.amount, dueOn: result.reading.dueOn, pressure: result.reading.pressure } : result.kind;
  const passed = JSON.stringify(got) === JSON.stringify(each.expect);
  results.push({ name: each.name, input: each.image === undefined ? "text" : "photograph", passed, expected: each.expect, got });
  console.log(`${passed ? "pass" : "FAIL"}  ${each.name}${passed ? "" : `: expected ${JSON.stringify(each.expect)}, got ${JSON.stringify(got)}`}`);
}
process.exitCode = writeEvalResults("documents", { prompt: DOCUMENT_PROMPT_VERSION, model: config.model, api: config.api, cases: results });
