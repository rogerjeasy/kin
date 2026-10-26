import { PollyClient, SynthesizeSpeechCommand, type LanguageCode, type VoiceId } from "@aws-sdk/client-polly";
import { StartStreamTranscriptionCommand, TranscribeStreamingClient, type LanguageCode as TranscribeLanguage } from "@aws-sdk/client-transcribe-streaming";

import { SPEECH_LANGUAGES } from "./languages.ts";
import { MAX_RECORDING_BYTES, PCM_SAMPLE_RATE, SpeechUnavailableError, type Transcriber, type Voice } from "./speech.ts";

/** A tenth of a second of 16 kHz 16-bit audio: Transcribe's recommended frame. */
const FRAME_BYTES = 3_200;

/**
 * Amazon Transcribe streaming. The recording is sent as a stream of frames
 * and the final (not partial) results are joined. Credentials come from the
 * AWS provider chain.
 */
export function awsTranscriber(region: string): Transcriber {
  const client = new TranscribeStreamingClient({ region });
  return async ({ pcm, locale }) => {
    if (pcm.byteLength === 0 || pcm.byteLength > MAX_RECORDING_BYTES) throw new RangeError("A recording must be between one frame and one minute long");
    async function* frames() {
      for (let start = 0; start < pcm.byteLength; start += FRAME_BYTES) {
        yield { AudioEvent: { AudioChunk: pcm.subarray(start, start + FRAME_BYTES) } };
      }
    }
    try {
      const response = await client.send(
        new StartStreamTranscriptionCommand({
          LanguageCode: SPEECH_LANGUAGES[locale].transcribe as TranscribeLanguage,
          MediaEncoding: "pcm",
          MediaSampleRateHertz: PCM_SAMPLE_RATE,
          AudioStream: frames(),
        }),
      );
      const parts: string[] = [];
      for await (const event of response.TranscriptResultStream ?? []) {
        for (const result of event.TranscriptEvent?.Transcript?.Results ?? []) {
          if (result.IsPartial === false) parts.push(result.Alternatives?.[0]?.Transcript ?? "");
        }
      }
      return parts.join(" ").trim();
    } catch (error) {
      throw new SpeechUnavailableError("Amazon Transcribe could not transcribe the recording", { cause: error });
    }
  };
}

/** Amazon Polly's neural voices, as MP3. */
export function awsVoice(region: string): Voice {
  const client = new PollyClient({ region });
  return async ({ text, locale }) => {
    const voice = SPEECH_LANGUAGES[locale].voice;
    if (voice === null) return null;
    try {
      const response = await client.send(
        new SynthesizeSpeechCommand({ Engine: "neural", OutputFormat: "mp3", TextType: "text", Text: text, VoiceId: voice.id as VoiceId, LanguageCode: voice.languageCode as LanguageCode }),
      );
      const audio = await response.AudioStream?.transformToByteArray();
      if (!audio || audio.byteLength === 0) throw new Error("Polly returned no audio");
      return { audio, contentType: "audio/mpeg" };
    } catch (error) {
      throw new SpeechUnavailableError("Amazon Polly could not speak the sentence", { cause: error });
    }
  };
}
