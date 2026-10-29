/** Audio Kin hears: 16-bit little-endian mono PCM at 16 kHz, the format Transcribe streams. */
export const PCM_SAMPLE_RATE = 16_000;

/** The longest recording Kin accepts at once: one minute. */
export const MAX_RECORDING_SECONDS = 60;
export const MAX_RECORDING_BYTES = PCM_SAMPLE_RATE * 2 * MAX_RECORDING_SECONDS;

/**
 * The languages Kin speaks, as its own locale codes. Speech reaches the
 * outside world through these ports only: the AWS adapters in production,
 * fakes in tests.
 */
export type SpeechLocale = "en" | "fr" | "de" | "es" | "it" | "ar" | "he";

/** Turns recorded speech into text, in the language the person speaks. */
export type Transcriber = (recording: { readonly pcm: Uint8Array; readonly locale: SpeechLocale }) => Promise<string>;

/** Speaks a sentence aloud, or `null` for a language Kin has no voice in. */
export type Voice = (speech: { readonly text: string; readonly locale: SpeechLocale }) => Promise<{ readonly audio: Uint8Array; readonly contentType: "audio/mpeg" } | null>;

/** The speech service could not be reached or answered wrongly. A retry may help. */
export class SpeechUnavailableError extends Error {
  readonly retryable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SpeechUnavailableError";
  }
}
