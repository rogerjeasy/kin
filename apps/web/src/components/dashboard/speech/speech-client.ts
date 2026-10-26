"use client";

/** The speech routes, from the browser. The server decides everything; these only carry audio and words. */
export type SpeechError = { ok: false; reason: string };

async function reply<T>(response: Response): Promise<T | SpeechError> {
  try {
    const body = (await response.json()) as unknown;
    if (typeof body === "object" && body !== null && "ok" in body) return body as T | SpeechError;
  } catch {
    // Not JSON: an outage, said the same way as any other.
  }
  return { ok: false, reason: "unavailable" };
}

export async function transcribe(pcm: Uint8Array, locale: string): Promise<{ ok: true; transcript: string; answer: "yes" | "no" | "unclear" } | SpeechError> {
  try {
    const response = await fetch(`/api/speech/transcribe?${new URLSearchParams({ locale })}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(pcm) });
    return reply(response);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function answerByVoice(pcm: Uint8Array, query: { proposal: string; locale: string; step: "answer" | "confirm"; decision?: "approve" | "reject" }): Promise<{ ok: true; decision: "approve" | "reject"; outcome: string } | SpeechError> {
  try {
    const params = new URLSearchParams({ proposal: query.proposal, locale: query.locale, step: query.step, ...(query.decision ? { decision: query.decision } : {}) });
    return reply(await fetch(`/api/speech/answer?${params}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(pcm) }));
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Asks Kin to read something aloud, and plays it. Resolves once it has finished speaking. */
export async function speak(request: Record<string, unknown>): Promise<{ ok: true } | SpeechError> {
  let response: Response;
  try {
    response = await fetch("/api/speech/say", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!response.ok || response.headers.get("content-type") !== "audio/mpeg") return reply(response);
  const url = URL.createObjectURL(await response.blob());
  const audio = new Audio(url);
  try {
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("playback"));
      audio.play().catch(reject);
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  } finally {
    URL.revokeObjectURL(url);
  }
}
