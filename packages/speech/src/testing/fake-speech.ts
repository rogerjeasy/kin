import type { Transcriber, Voice } from "../speech.ts";

/** Hears the next transcript for each recording, and keeps what it heard. */
export function fakeTranscriber(...transcripts: string[]): Transcriber & { readonly heard: { bytes: number; locale: string }[] } {
  const heard: { bytes: number; locale: string }[] = [];
  const transcriber: Transcriber = async ({ pcm, locale }) => {
    heard.push({ bytes: pcm.byteLength, locale });
    const next = transcripts.shift();
    if (next === undefined) throw new Error("The fake transcriber heard more than expected");
    return next;
  };
  return Object.assign(transcriber, { heard });
}

/** Speaks every sentence as its own UTF-8 bytes, and keeps what it said. */
export function fakeVoice(): Voice & { readonly said: { text: string; locale: string }[] } {
  const said: { text: string; locale: string }[] = [];
  const voice: Voice = async ({ text, locale }) => {
    said.push({ text, locale });
    return locale === "he" ? null : { audio: new TextEncoder().encode(text), contentType: "audio/mpeg" };
  };
  return Object.assign(voice, { said });
}
