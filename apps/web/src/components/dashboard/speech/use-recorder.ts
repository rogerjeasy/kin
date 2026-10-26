"use client";

import { useRef, useState } from "react";

import { MAX_SECONDS, toPcm16k } from "./pcm";

export type RecorderState = "idle" | "recording" | "denied";

// Passes each block of microphone samples to the page. Loaded from memory,
// so it needs no file served beside the app.
const CAPTURE = `class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);`;

type Session = { context: AudioContext; stream: MediaStream; chunks: Float32Array[]; timer: ReturnType<typeof setTimeout>; done: (pcm: Uint8Array) => void };

/**
 * Records from the microphone until stopped, or for a minute at most, and
 * hands back 16 kHz PCM. The microphone is released as soon as it stops.
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const session = useRef<Session | null>(null);

  function finish(): void {
    const current = session.current;
    if (current === null) return;
    session.current = null;
    clearTimeout(current.timer);
    for (const track of current.stream.getTracks()) track.stop();
    const pcm = toPcm16k(current.chunks, current.context.sampleRate);
    void current.context.close();
    setState("idle");
    current.done(pcm);
  }

  /** Starts recording; resolves with the recording once `stop` is called or the minute is up. */
  async function record(): Promise<Uint8Array | null> {
    if (session.current !== null) return null;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch {
      setState("denied");
      return null;
    }
    const context = new AudioContext();
    const module = URL.createObjectURL(new Blob([CAPTURE], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(module);
    } finally {
      URL.revokeObjectURL(module);
    }
    const node = new AudioWorkletNode(context, "pcm-capture");
    const chunks: Float32Array[] = [];
    node.port.onmessage = (event: MessageEvent<Float32Array>) => chunks.push(event.data);
    context.createMediaStreamSource(stream).connect(node);
    setState("recording");
    return new Promise((resolve) => {
      session.current = { context, stream, chunks, timer: setTimeout(finish, MAX_SECONDS * 1000), done: resolve };
    });
  }

  return { state, record, stop: finish };
}
