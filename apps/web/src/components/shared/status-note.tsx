import { InfoIcon } from "lucide-react";

type StatusNoteProps = { title: string; text: string };

/** A plain statement of where things stand, set apart from the pitch around it. */
export function StatusNote({ title, text }: StatusNoteProps) {
  return (
    <div role="note" className="surface grid max-w-2xl grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3.5 rounded-2xl border-gold/40 p-5">
      <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-gold/15">
        <InfoIcon className="size-4.5 text-highlight" />
      </span>
      <p>
        <strong className="block font-semibold">{title}</strong>
        <span className="mt-1 block text-muted-foreground">{text}</span>
      </p>
    </div>
  );
}
