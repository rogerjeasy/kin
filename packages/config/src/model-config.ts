import { ConfigError } from "./config-error.ts";
import { isLocalAddress } from "./local-address.ts";

export const MODEL_ENV = {
  /** The AWS region whose Amazon Bedrock serves Claude, such as `us-east-1`. Unset turns the model off. */
  region: "KIN_BEDROCK_REGION",
  /** Which Bedrock API carries the calls: `mantle` or `invoke` (docs/tech-stack.md section 6). */
  api: "KIN_BEDROCK_API",
  /** The Bedrock model ID; the default depends on the API (docs/tech-stack.md section 6). */
  model: "KIN_BEDROCK_MODEL",
  /** A stand-in for Bedrock's Messages endpoint, on this machine, for tests. */
  endpoint: "KIN_BEDROCK_ENDPOINT",
} as const;

export type BedrockApi = "mantle" | "invoke";

/** Claude Opus 5.5 on Amazon Bedrock's Mantle endpoint. */
export const BEDROCK_DEFAULT_MODEL = "anthropic.claude-opus-5-5";
/** Claude Opus 4.6 through InvokeModel's cross-region inference profile, for accounts without Opus 5.5. */
export const BEDROCK_INVOKE_DEFAULT_MODEL = "us.anthropic.claude-opus-4-6-v1";

/**
 * Where Kin reaches Claude. Off when no region is set, so a deployment
 * without the model still serves every screen; the features that need it
 * say they are unavailable.
 */
export type ModelConfig =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly region: string; readonly api: BedrockApi; readonly model: string; readonly endpoint: string | null };

type Env = Readonly<Record<string, string | undefined>>;

const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;
const MODEL_ID = /^[a-z0-9.:-]+$/;

/** Reads Kin's model settings. Credentials come from the AWS provider chain, never from here. */
export function readModelConfig(env: Env): ModelConfig {
  const region = env[MODEL_ENV.region]?.trim() ?? "";
  if (region === "") return { enabled: false };
  if (!REGION.test(region)) throw new ConfigError(`${MODEL_ENV.region} is not an AWS region`);
  const api = env[MODEL_ENV.api]?.trim() || "mantle";
  if (api !== "mantle" && api !== "invoke") throw new ConfigError(`${MODEL_ENV.api} must be mantle or invoke`);
  const model = env[MODEL_ENV.model]?.trim() || (api === "invoke" ? BEDROCK_INVOKE_DEFAULT_MODEL : BEDROCK_DEFAULT_MODEL);
  if (!MODEL_ID.test(model)) throw new ConfigError(`${MODEL_ENV.model} is not a Bedrock model ID`);
  const endpoint = env[MODEL_ENV.endpoint]?.trim() || null;
  if (endpoint !== null && !isLocalAddress(endpoint)) throw new ConfigError(`${MODEL_ENV.endpoint} must be a stand-in on this machine`);
  return { enabled: true, region, api, model, endpoint };
}
