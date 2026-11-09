import { PCM_SAMPLE_RATE } from "@kin/speech";

const HEADER_BYTES = 44;

/**
 * Wraps 16-bit little-endian mono PCM at 16 kHz, the audio Kin records, in a
 * WAV header, so a browser plays it as it is with nothing to decode it.
 */
export function wavFromPcm(pcm: Uint8Array): Uint8Array {
  const wav = new Uint8Array(HEADER_BYTES + pcm.byteLength);
  const view = new DataView(wav.buffer);
  const text = (offset: number, value: string) => wav.set(new TextEncoder().encode(value), offset);
  text(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, PCM_SAMPLE_RATE, true);
  view.setUint32(28, PCM_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  wav.set(pcm, HEADER_BYTES);
  return wav;
}
