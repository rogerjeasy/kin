import { readSpeechConfig } from "@kin/config";
import { awsTranscriber, awsVoice, type Transcriber, type Voice } from "@kin/speech";

import { createRateLimiter } from "./model";

export type SpeechServices = { readonly transcriber: Transcriber; readonly voice: Voice };

let services: SpeechServices | null | undefined;

/** Amazon Transcribe and Polly, or `null` when this deployment has no speech. Read on first use. */
export function speechServices(): SpeechServices | null {
  if (services === undefined) {
    const config = readSpeechConfig(process.env);
    services = config.enabled ? { transcriber: awsTranscriber(config.region), voice: awsVoice(config.region) } : null;
  }
  return services;
}

/** Each person may use speech sixty times an hour: a bill or an answer takes a few. */
export const speechLimiter = createRateLimiter(60, 60 * 60 * 1000);
/** And each server 600 times an hour for demo visitors, and as many for people who signed in. */
export const speechBudget = createRateLimiter(600, 60 * 60 * 1000);
