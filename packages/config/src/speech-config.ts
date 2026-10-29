import { ConfigError } from "./config-error.ts";

export const SPEECH_ENV = {
  /** The AWS region whose Amazon Transcribe and Amazon Polly Kin uses. Unset turns speech off. */
  region: "KIN_SPEECH_REGION",
} as const;

export type SpeechConfig = { readonly enabled: false } | { readonly enabled: true; readonly region: string };

const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;

/** Reads Kin's speech settings. Credentials come from the AWS provider chain, never from here. */
export function readSpeechConfig(env: Readonly<Record<string, string | undefined>>): SpeechConfig {
  const region = env[SPEECH_ENV.region]?.trim() ?? "";
  if (region === "") return { enabled: false };
  if (!REGION.test(region)) throw new ConfigError(`${SPEECH_ENV.region} is not an AWS region`);
  return { enabled: true, region };
}
