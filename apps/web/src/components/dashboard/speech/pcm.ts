/** The rate Transcribe hears: 16-bit mono PCM at 16 kHz (packages/speech). */
export const TARGET_RATE = 16_000;
export const MAX_SECONDS = 60;

/**
 * Microphone samples at the device's own rate, as 16 kHz 16-bit
 * little-endian PCM. Each output sample averages the input samples it
 * covers, which is enough for speech and avoids aliasing from plain skipping.
 */
export function toPcm16k(chunks: readonly Float32Array[], inputRate: number): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  const ratio = inputRate / TARGET_RATE;
  const length = Math.min(Math.floor(total / ratio), TARGET_RATE * MAX_SECONDS);
  const out = new DataView(new ArrayBuffer(length * 2));
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.max(start + 1, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let at = start; at < end; at += 1) sum += samples[at] ?? 0;
    const value = Math.max(-1, Math.min(1, sum / (end - start)));
    out.setInt16(index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Uint8Array(out.buffer);
}
