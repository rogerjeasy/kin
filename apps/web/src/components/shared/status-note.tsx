import { InfoIcon } from "lucide-react";

type StatusNoteProps = { title: string; text: string };

/** A plain statement of where things stand, set apart from the pitch around it. */
export function StatusNote({ title, text }: StatusNoteProps) {
  return (
    <div role="note" className="grid max-w-2xl grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3.5 rounded-2xl border border-s-4 border-s-highlight bg-card p-5">
      <InfoIcon aria-hidden="true" className="mt-0.5 size-5 text-highlight" />
      <p>
        <strong className="block font-semibold">{title}</strong>
        <span className="mt-1 block text-muted-foreground">{text}</span>
      </p>
    </div>
  );
}
