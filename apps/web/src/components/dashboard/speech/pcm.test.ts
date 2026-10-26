import { describe, expect, it } from "vitest";

import { MAX_SECONDS, TARGET_RATE, toPcm16k } from "./pcm";

describe("microphone samples as Transcribe's PCM", () => {
  it("brings 48 kHz down to 16 kHz, two bytes a sample, little-endian", () => {
    const pcm = toPcm16k([new Float32Array(4_800).fill(0.5), new Float32Array(4_800).fill(-1)], 48_000);
    expect(pcm.byteLength).toBe(3_200 * 2);
    const view = new DataView(pcm.buffer);
    expect(view.getInt16(0, true)).toBe(Math.trunc(0.5 * 0x7fff));
    expect(view.getInt16(pcm.byteLength - 2, true)).toBe(-0x8000);
  });

  it("clips what is out of range, and never returns more than a minute", () => {
    expect(new DataView(toPcm16k([new Float32Array(16).fill(3)], 16_000).buffer).getInt16(0, true)).toBe(0x7fff);
    expect(toPcm16k([new Float32Array(TARGET_RATE * (MAX_SECONDS + 5))], TARGET_RATE).byteLength).toBe(TARGET_RATE * MAX_SECONDS * 2);
  });
});
