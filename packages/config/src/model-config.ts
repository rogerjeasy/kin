import { ConfigError } from "./config-error.ts";
import { isLocalAddress } from "./local-address.ts";

export const MODEL_ENV = {
  /** The AWS region whose Amazon Bedrock serves Claude, such as `us-east-1`. Unset turns the model off. */
  region: "KIN_BEDROCK_REGION",
  /** The Bedrock model ID; Claude Opus 5.5 unless set (docs/tech-stack.md section 6). */
  model: "KIN_BEDROCK_MODEL",
  /** A stand-in for Bedrock's Messages endpoint, on this machine, for tests. */
  endpoint: "KIN_BEDROCK_ENDPOINT",
} as const;

/** Claude Opus 5.5 on Amazon Bedrock. */
export const BEDROCK_DEFAULT_MODEL = "anthropic.claude-opus-5-5";

/**
 * Where Kin reaches Claude. Off when no region is set, so a deployment
 * without the model still serves every screen; the features that need it
 * say they are unavailable.
 */
export type ModelConfig =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly region: string; readonly model: string; readonly endpoint: string | null };

type Env = Readonly<Record<string, string | undefined>>;

const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;
const MODEL_ID = /^[a-z0-9.:-]+$/;

/** Reads Kin's model settings. Credentials come from the AWS provider chain, never from here. */
export function readModelConfig(env: Env): ModelConfig {
  const region = env[MODEL_ENV.region]?.trim() ?? "";
  if (region === "") return { enabled: false };
  if (!REGION.test(region)) throw new ConfigError(`${MODEL_ENV.region} is not an AWS region`);
  const model = env[MODEL_ENV.model]?.trim() || BEDROCK_DEFAULT_MODEL;
  if (!MODEL_ID.test(model)) throw new ConfigError(`${MODEL_ENV.model} is not a Bedrock model ID`);
  const endpoint = env[MODEL_ENV.endpoint]?.trim() || null;
  if (endpoint !== null && !isLocalAddress(endpoint)) throw new ConfigError(`${MODEL_ENV.endpoint} must be a stand-in on this machine`);
  return { enabled: true, region, model, endpoint };
}
