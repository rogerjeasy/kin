import { Waveform } from "@/components/shared/waveform";

/**
 * While the microphone is open: a red dot that keeps time, the words that say
 * so, and a waveform beside them. The words are announced; the rest is decoration.
 */
export function ListeningLine({ text }: { text: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
      <p role="status" className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="relative inline-flex size-2.5 shrink-0">
          <span className="absolute inset-0 rounded-full bg-danger motion-safe:animate-dot-ping" />
          <span className="relative size-2.5 rounded-full bg-danger" />
        </span>
        <span className="min-w-0">{text}</span>
      </p>
      <span aria-hidden="true" className="flex min-w-0 flex-1 basis-32 items-center">
        <Waveform />
      </span>
    </div>
  );
}
